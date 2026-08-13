const test = require("node:test");
const assert = require("node:assert/strict");
const { rolesFromCognitoGroups } = require("../../utils/auth/roles");
const { sanitizeMetadata } = require("../../utils/security/sanitize");
const { setAuthCookies, parseCookies } = require("../../utils/http/httpCookies");
const { buildAuthorizationUrl, getLogoutUrl } = require("../../utils/auth/cognitoClient");

test("only verified Cognito groups map to application roles", () => {
    assert.deepEqual(
        rolesFromCognitoGroups({ "cognito:groups": ["Admin", "RegistrationOfficer", "Unknown"] }),
        ["ADMINISTRATOR", "REGISTRATION_OFFICER"]
    );
    assert.deepEqual(rolesFromCognitoGroups({ role: "ADMINISTRATOR" }), []);
});

test("Cognito authorization uses code flow with PKCE and exact state binding", () => {
    process.env.COGNITO_DOMAIN = "https://auth.tests.vsms.local";
    process.env.COGNITO_APP_CLIENT_ID = "security-test-client";
    process.env.COGNITO_REDIRECT_URI = "https://localhost:5173/auth/callback";
    const url = new URL(buildAuthorizationUrl({ state: "exact-state", codeChallenge: "pkce-challenge" }));
    assert.equal(url.origin, "https://auth.tests.vsms.local");
    assert.equal(url.pathname, "/oauth2/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "exact-state");
    assert.equal(url.searchParams.get("code_challenge"), "pkce-challenge");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.has("client_secret"), false);
});

test("Cognito logout URL is restricted to the configured application return", () => {
    process.env.COGNITO_LOGOUT_URI = "https://localhost:5173/login";
    const url = new URL(getLogoutUrl());
    assert.equal(url.origin, "https://auth.tests.vsms.local");
    assert.equal(url.pathname, "/logout");
    assert.equal(url.searchParams.get("client_id"), "security-test-client");
    assert.equal(url.searchParams.get("logout_uri"), "https://localhost:5173/login");
});

test("credential cookies are HttpOnly while the double-submit CSRF cookie is script-readable", () => {
    let values;
    const response = {
        getHeader() { return values; },
        setHeader(name, value) { if (name === "Set-Cookie") values = value; },
    };
    setAuthCookies(response, {
        AccessToken: "access-secret",
        RefreshToken: "refresh-secret",
        ExpiresIn: 3600,
    }, "staff@example.com");
    assert.deepEqual(values.map((entry) => entry.split("=", 1)[0]), [
        "vsms_access", "vsms_username", "vsms_csrf", "vsms_refresh",
    ]);
    for (const value of values.filter((entry) => !entry.startsWith("vsms_csrf="))) {
        assert.match(value, /HttpOnly/);
        assert.match(value, /SameSite=Lax/);
        assert.match(value, /Secure/);
    }
    const csrf = values.find((entry) => entry.startsWith("vsms_csrf="));
    assert.doesNotMatch(csrf, /HttpOnly/);
    assert.match(csrf, /SameSite=Lax/);
    assert.match(csrf, /Secure/);
});

test("cookie parser handles encoded values", () => {
    assert.deepEqual(parseCookies("a=one; b=two%20words"), { a: "one", b: "two words" });
});

test("audit metadata redacts credentials, tokens and signature evidence", () => {
    const safe = sanitizeMetadata({
        action: "test",
        password: "secret",
        accessToken: "token",
        nested: { signatureObjectKey: "private/key", participantId: "abc", NRIC: "S1234567A", emailAddress: "person@example.test" },
    });
    assert.equal(safe.password, "[REDACTED]");
    assert.equal(safe.accessToken, "[REDACTED]");
    assert.equal(safe.nested.signatureObjectKey, "[REDACTED]");
    assert.equal(safe.nested.participantId, "abc");
    assert.equal(safe.nested.NRIC, "[REDACTED]");
    assert.equal(safe.nested.emailAddress, "[REDACTED]");
});
