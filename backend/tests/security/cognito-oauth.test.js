const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
delete process.env.REFRESH_COOKIE_MAX_AGE_SECONDS;

Object.assign(process.env, {
    COGNITO_REGION: "us-east-1",
    COGNITO_USER_POOL_ID: "us-east-1_test",
    COGNITO_APP_CLIENT_ID: "test-client",
    COGNITO_DOMAIN: "https://vsms.auth.us-east-1.amazoncognito.com",
    COGNITO_REDIRECT_URI: "https://localhost:5173/auth/callback",
    COGNITO_LOGOUT_URI: "https://localhost:5173",
    PUBLIC_APP_ORIGIN: "https://localhost:5173",
    PUBLIC_SIGNUP_ENABLED: "true",
    AUTH_RATE_LIMIT: "100",
});

const cognitoClient =
    require("../../utils/auth/cognitoClient");

const cognitoJwt =
    require("../../utils/auth/cognitoJwt");

const accountService =
    require("../../services/account/accountService");

const AuthAudit =
    require("../../utils/logging/audit");

const { AppError } =
    require("../../errors/AppError");

let localUserMode = "active";

/*
 * Mock Cognito authorization-code exchange.
 */
cognitoClient.exchangeAuthorizationCode =
    async (code, verifier) => {
        assert.equal(code, "authorization-code");
        assert.equal(verifier, "verifier");

        return {
            AccessToken: "access",
            IdToken: "id",
            RefreshToken: "refresh",
            ExpiresIn: 3600,
        };
    };

/*
 * Mock Cognito JWT verification.
 */
cognitoJwt.verifyCognitoToken =
    async (_token, tokenUse) => {
        if (tokenUse === "id") {
            return {
                sub: "cognito-user",
                email: "staff@example.com",
                email_verified: true,
                name: "Test Staff",
            };
        }

        return {
            sub: "cognito-user",
            auth_time: Math.floor(Date.now() / 1000),
        };
    };

/*
 * Mock local account lookup.
 */
accountService.syncCognitoUser =
    async () => {
        if (localUserMode === "missing") {
            throw new AppError(
                403,
                "LOCAL_PROFILE_NOT_FOUND",
                "Access denied",
            );
        }

        return {
            id: "staff-id",
            email: "staff@example.com",
            status: "ACTIVE",
            accessState:
                localUserMode === "blocked"
                    ? "DISABLED"
                    : "ENABLED",
            approvalState: "APPROVED",
            deprovisionedAt: null,
            sessionInvalidBefore: null,
            userRoles: [
                {
                    role: {
                        roleName: "EVENT_MANAGER",
                    },
                },
            ],
        };
    };

/*
 * Prevent the callback test from touching the database.
 */
accountService.recordSuccessfulLogin =
    async () => new Date();

accountService.recordAuthAudit =
    async () => {};

AuthAudit.createAuthAuditLog =
    async () => {};

/*
 * Load app only after mocks are installed.
 */
const app = require("../../app");


test(
    "authorize route creates a PKCE authorization URL and stores the protected return target",
    async () => {
        const response = await request(app)
            .get(
                "/api/v1/auth/authorize" +
                "?returnTo=%2Fevents%3Fview%3Dupcoming"
            );

        assert.equal(response.status, 302);

        const authorizationUrl =
            new URL(response.headers.location);

        assert.equal(
            authorizationUrl.origin,
            "https://vsms.auth.us-east-1.amazoncognito.com",
        );

        assert.equal(
            authorizationUrl.pathname,
            "/oauth2/authorize",
        );

        assert.equal(
            authorizationUrl.searchParams.get("response_type"),
            "code",
        );

        assert.equal(
            authorizationUrl.searchParams.get(
                "code_challenge_method"
            ),
            "S256",
        );

        assert.ok(
            authorizationUrl.searchParams.get("state")
        );

        assert.ok(
            authorizationUrl.searchParams.get("code_challenge")
        );

        assert.ok(
            response.headers["set-cookie"].some(
                (cookie) =>
                    cookie.startsWith(
                        "vsms_oauth_return_to=%2Fevents%3Fview%3Dupcoming"
                    )
            )
        );
    }
);


test(
    "authorize forwards the sign-up hint to Cognito",
    async () => {
        const response = await request(app)
            .get(
                "/api/v1/auth/authorize?screen_hint=signup"
            );

        const authorizationUrl =
            new URL(response.headers.location);

        assert.equal(
            authorizationUrl.searchParams.get("screen_hint"),
            "signup",
        );
    }
);


test(
    "callback returns the same-origin protected target after authorization-code exchange",
    async () => {
        localUserMode = "active";

        const response = await request(app)
            .get(
                "/api/v1/auth/callback" +
                "?code=authorization-code&state=state"
            )
            .set(
                "Cookie",
                [
                    "vsms_oauth_state=state",
                    "vsms_oauth_verifier=verifier",
                    "vsms_oauth_return_to=" +
                        encodeURIComponent(
                            "https://localhost:5173/events?view=upcoming"
                        ),
                ].join("; ")
            );

        console.log(
            "CALLBACK STATUS:",
            response.status
        );

        console.log(
            "CALLBACK BODY:",
            response.body
        );

        assert.equal(response.status, 200);

        assert.equal(response.body.sessionExpiresIn, 24 * 60 * 60);

        assert.ok(
            response.headers["set-cookie"].some(
                (cookie) =>
                    cookie.startsWith("vsms_refresh=") &&
                    cookie.includes("Max-Age=86400")
            )
        );

        assert.equal(
            response.body.returnTo,
            "/events?view=upcoming",
        );
    }
);


test(
    "callback distinguishes a missing local profile from another blocked account state",
    async () => {
        try {
            localUserMode = "missing";

            const missing = await request(app)
                .get(
                    "/api/v1/auth/callback" +
                    "?code=authorization-code&state=state"
                )
                .set(
                    "Cookie",
                    "vsms_oauth_state=state; " +
                    "vsms_oauth_verifier=verifier"
                );

            assert.equal(missing.status, 403);

            assert.equal(
                missing.body.code,
                "LOCAL_PROFILE_NOT_FOUND",
            );


            localUserMode = "blocked";

            const blocked = await request(app)
                .get(
                    "/api/v1/auth/callback" +
                    "?code=authorization-code&state=state"
                )
                .set(
                    "Cookie",
                    "vsms_oauth_state=state; " +
                    "vsms_oauth_verifier=verifier"
                );

            assert.equal(blocked.status, 403);

            assert.equal(
                blocked.body.code,
                "ACCOUNT_SESSION_BLOCKED",
            );
        } finally {
            localUserMode = "active";
        }
    }
);


const invalidReturnTargets = [
    "/",
    "https://untrusted.example/events",
    "https://localhost:5173//untrusted",
    "/auth/callback",
    "/api/v1/auth/authorize",
];


for (const returnTo of invalidReturnTargets) {
    test(
        `callback defaults invalid return target ${returnTo} to events`,
        async () => {
            localUserMode = "active";

            const response = await request(app)
                .get(
                    "/api/v1/auth/callback" +
                    "?code=authorization-code&state=state"
                )
                .set(
                    "Cookie",
                    [
                        "vsms_oauth_state=state",
                        "vsms_oauth_verifier=verifier",
                        "vsms_oauth_return_to=" +
                            encodeURIComponent(returnTo),
                    ].join("; ")
                );

            console.log(
                `CALLBACK STATUS FOR ${returnTo}:`,
                response.status,
            );

            assert.equal(response.status, 200);

            assert.equal(
                response.body.returnTo,
                "/events",
            );
        }
    );
}
