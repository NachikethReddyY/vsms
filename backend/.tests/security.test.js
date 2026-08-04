const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rolesFromCognitoGroups } = require("../utils/roles");
const { sanitizeMetadata } = require("../utils/sanitize");
const { setAuthCookies, parseCookies } = require("../utils/httpCookies");

test("only verified Cognito groups map to application roles", () => {
    assert.deepEqual(
        rolesFromCognitoGroups({ "cognito:groups": ["Admin", "RegistrationOfficer", "Unknown"] }),
        ["ADMINISTRATOR", "REGISTRATION_OFFICER"]
    );
    assert.deepEqual(rolesFromCognitoGroups({ role: "ADMINISTRATOR" }), []);
});

test("credential cookies are HttpOnly while the double-submit CSRF cookie stays readable", () => {
    let values;
    const response = {
        getHeader(name) { return name === "Set-Cookie" ? values : undefined; },
        setHeader(name, value) { if (name === "Set-Cookie") values = value; },
    };
    setAuthCookies(response, {
        AccessToken: "access-secret",
        RefreshToken: "refresh-secret",
        ExpiresIn: 3600,
    }, "staff@example.com");
    assert.equal(values.length, 4);
    for (const value of values.filter((cookie) => !cookie.startsWith("vsms_csrf="))) {
        assert.match(value, /HttpOnly/);
        assert.match(value, /SameSite=Lax/);
    }
    assert.doesNotMatch(values.find((cookie) => cookie.startsWith("vsms_csrf=")), /HttpOnly/);
});

test("cookie parser handles encoded values", () => {
    assert.deepEqual(parseCookies("a=one; b=two%20words"), { a: "one", b: "two words" });
});

test("audit metadata redacts credentials, tokens and signature evidence", () => {
    const safe = sanitizeMetadata({
        action: "test",
        password: "secret",
        accessToken: "token",
        nested: { signatureObjectKey: "private/key", participantId: "abc" },
    });
    assert.equal(safe.password, "[REDACTED]");
    assert.equal(safe.accessToken, "[REDACTED]");
    assert.equal(safe.nested.signatureObjectKey, "[REDACTED]");
    assert.equal(safe.nested.participantId, "abc");
});

test("demonstration seeding is production-blocked and does not print pass tokens", () => {
    const source = fs.readFileSync(path.join(__dirname, "../prisma/seed.js"), "utf8");
    assert.match(source, /NODE_ENV === "production"/);
    assert.doesNotMatch(source, /Demo QR token/);
});

test("startup does not claim release integrity without an enforced signing pipeline", () => {
    const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
    assert.doesNotMatch(app, /Code signature successfully verified|existsSync\(sigPath\)/);
    assert.equal(fs.existsSync(path.join(__dirname, "../utils/verifyCodeSignature.js")), false);
});
