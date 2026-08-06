const assert = require("node:assert/strict");
const test = require("node:test");
const { buildAuthorizationUrl } = require("../../utils/cognitoClient");
const { setAuthCookies, setOAuthCookies } = require("../../utils/httpCookies");
const { normalizeReturnTo } = require("../../controllers/authController");

test("managed login uses an authorization-code grant with PKCE", () => {
    const previous = { ...process.env };
    Object.assign(process.env, {
        COGNITO_DOMAIN: "https://vsms.auth.ap-southeast-1.amazoncognito.com",
        COGNITO_APP_CLIENT_ID: "client-id",
        COGNITO_REDIRECT_URI: "https://localhost:5173/auth/callback",
    });

    try {
        const url = new URL(buildAuthorizationUrl({ state: "state", codeChallenge: "challenge" }));
        assert.equal(url.pathname, "/oauth2/authorize");
        assert.equal(url.searchParams.get("response_type"), "code");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.equal(url.searchParams.get("code_challenge"), "challenge");
        assert.equal(url.searchParams.get("state"), "state");
        assert.equal(url.searchParams.get("redirect_uri"), "https://localhost:5173/auth/callback");
    } finally {
        process.env = previous;
    }
});

test("OAuth cookies are always Secure", () => {
    const headers = new Map();
    const response = {
        getHeader: (name) => headers.get(name),
        setHeader: (name, value) => headers.set(name, value),
    };

    setOAuthCookies(response, { state: "state", verifier: "verifier", returnTo: "/events" });

    assert.equal(headers.get("Set-Cookie").length, 3);
    assert.ok(headers.get("Set-Cookie").every((cookie) => cookie.includes("; Secure;")));
});

test("auth cookies include a script-readable CSRF token without exposing credentials", () => {
    const headers = new Map();
    const response = {
        getHeader: (name) => headers.get(name),
        setHeader: (name, value) => headers.set(name, value),
    };

    setAuthCookies(response, { AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 60 }, "staff@example.com");

    const cookies = headers.get("Set-Cookie");
    const csrf = cookies.find((value) => value.startsWith("vsms_csrf="));
    assert.ok(csrf);
    assert.ok(!csrf.includes("HttpOnly"));
    assert.ok(cookies.filter((value) => !value.startsWith("vsms_csrf=")).every((value) => value.includes("HttpOnly")));
});

test("managed login return paths stay on the configured application", () => {
    assert.equal(normalizeReturnTo("/events/123?tab=operations"), "/events/123?tab=operations");
    for (const unsafe of ["https://evil.example", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/%5c%5cevil.example", "/%0aevil.example"]) {
        assert.equal(normalizeReturnTo(unsafe), "/events");
    }
});
