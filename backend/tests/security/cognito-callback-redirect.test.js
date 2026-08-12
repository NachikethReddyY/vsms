const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

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

const cognitoClient = require("../../utils/auth/cognitoClient");
const cognitoJwt = require("../../utils/auth/cognitoJwt");
const accountService = require("../../services/account/accountService");
const AuthAudit = require("../../utils/logging/audit");
const { AppError } = require("../../errors/AppError");

let localUserMode = "active";

/*
 * Mock Cognito authorization-code exchange.
 */
cognitoClient.exchangeAuthorizationCode = async (code, verifier) => {
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
 *
 * The access token contains the claims required by:
 * - sessionValidity()
 * - rolesFromCognitoGroups()
 */
cognitoJwt.verifyCognitoToken = async (_token, tokenUse) => {
  const now = Math.floor(Date.now() / 1000);

  if (tokenUse === "id") {
    return {
      sub: "cognito-user",
      email: "staff@example.com",
      email_verified: true,
      token_use: "id",
      iat: now,
      exp: now + 3600,
    };
  }

  return {
    sub: "cognito-user",
    token_use: "access",
    auth_time: now,
    iat: now,
    exp: now + 3600,
    "cognito:groups": ["EVENT_MANAGER"],
  };
};

/*
 * Mock local account synchronization.
 *
 * The callback should distinguish:
 * 1. No local VSMS profile
 * 2. Existing but blocked VSMS account
 * 3. Active VSMS account
 */
accountService.syncCognitoUser = async () => {
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
    approvalState: "APPROVED",

    accessState:
      localUserMode === "blocked"
        ? "DISABLED"
        : "ENABLED",

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
 * Avoid writing to the database during the callback security tests.
 */
accountService.recordSuccessfulLogin = async () => new Date();

accountService.recordAuthAudit = async () => {};

AuthAudit.createAuthAuditLog = async () => {};

/*
 * Load the application after all mocks have been configured.
 */
const app = require("../../app");


test(
  "authorize route creates a PKCE authorization URL and stores the protected return target",
  async () => {
    const response = await request(app)
      .get(
        "/api/v1/auth/authorize?returnTo=%2Fevents%3Fview%3Dupcoming",
      );

    assert.equal(response.status, 302);

    const authorizationUrl = new URL(
      response.headers.location,
    );

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
        "code_challenge_method",
      ),
      "S256",
    );

    assert.ok(
      authorizationUrl.searchParams.get("state"),
    );

    assert.ok(
      authorizationUrl.searchParams.get("code_challenge"),
    );

    assert.ok(
      response.headers["set-cookie"].some(
        (cookie) =>
          cookie.startsWith(
            "vsms_oauth_return_to=%2Fevents%3Fview%3Dupcoming",
          ),
      ),
    );
  },
);


test(
  "authorize forwards the sign-up hint to Cognito",
  async () => {
    const response = await request(app)
      .get(
        "/api/v1/auth/authorize?screen_hint=signup",
      );

    assert.equal(response.status, 302);

    const authorizationUrl = new URL(
      response.headers.location,
    );

    assert.equal(
      authorizationUrl.searchParams.get("screen_hint"),
      "signup",
    );
  },
);


test(
  "callback returns the same-origin protected target after authorization-code exchange",
  async () => {
    const response = await request(app)
      .get(
        "/api/v1/auth/callback?code=authorization-code&state=state",
      )
      .set(
        "Cookie",
        [
          "vsms_oauth_state=state",
          "vsms_oauth_verifier=verifier",
          "vsms_oauth_return_to=https%3A%2F%2Flocalhost%3A5173%2Fevents%3Fview%3Dupcoming",
        ].join("; "),
      );

    /*
     * Temporary diagnostics.
     *
     * If this test still returns 500, these logs reveal
     * whether the failure comes from the callback itself,
     * authentication, or return-target handling.
     */
    if (response.status !== 200) {
      console.error(
        "CALLBACK STATUS:",
        response.status,
      );

      console.error(
        "CALLBACK BODY:",
        response.body,
      );

      console.error(
        "CALLBACK TEXT:",
        response.text,
      );
    }

    assert.equal(response.status, 200);

    assert.equal(
      response.body.returnTo,
      "/events?view=upcoming",
    );
  },
);


test(
  "callback distinguishes a missing local profile from another blocked account state",
  async () => {
    try {
      /*
       * No local VSMS profile.
       */
      localUserMode = "missing";

      const missing = await request(app)
        .get(
          "/api/v1/auth/callback?code=authorization-code&state=state",
        )
        .set(
          "Cookie",
          [
            "vsms_oauth_state=state",
            "vsms_oauth_verifier=verifier",
          ].join("; "),
        );

      assert.equal(missing.status, 403);

      assert.equal(
        missing.body.code,
        "LOCAL_PROFILE_NOT_FOUND",
      );

      /*
       * Local profile exists but access is disabled.
       */
      localUserMode = "blocked";

      const blocked = await request(app)
        .get(
          "/api/v1/auth/callback?code=authorization-code&state=state",
        )
        .set(
          "Cookie",
          [
            "vsms_oauth_state=state",
            "vsms_oauth_verifier=verifier",
          ].join("; "),
        );

      assert.equal(blocked.status, 403);

      assert.equal(
        blocked.body.code,
        "ACCOUNT_SESSION_BLOCKED",
      );
    } finally {
      /*
       * Always restore the default state so later tests
       * are not affected.
       */
      localUserMode = "active";
    }
  },
);


/*
 * These values must never become the final redirect target.
 *
 * The application should always fall back to:
 *
 *     /events
 */
for (
  const returnTo of [
    "/",
    "https://untrusted.example/events",
    "https://localhost:5173//untrusted",
    "/auth/callback",
    "/api/v1/auth/authorize",
  ]
) {
  test(
    `callback defaults invalid return target ${returnTo} to events`,
    async () => {
      const response = await request(app)
        .get(
          "/api/v1/auth/callback?code=authorization-code&state=state",
        )
        .set(
          "Cookie",
          [
            "vsms_oauth_state=state",
            "vsms_oauth_verifier=verifier",
            `vsms_oauth_return_to=${encodeURIComponent(
              returnTo,
            )}`,
          ].join("; "),
        );

      if (response.status !== 200) {
        console.error(
          `CALLBACK STATUS FOR ${returnTo}:`,
          response.status,
        );

        console.error(
          `CALLBACK BODY FOR ${returnTo}:`,
          response.body,
        );

        console.error(
          `CALLBACK TEXT FOR ${returnTo}:`,
          response.text,
        );
      }

      assert.equal(response.status, 200);

      assert.equal(
        response.body.returnTo,
        "/events",
      );
    },
  );
}
