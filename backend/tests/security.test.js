const test = require("node:test");
const assert = require("node:assert/strict");
const { rolesFromCognitoGroups } = require("../utils/roles");
const { sanitizeMetadata } = require("../utils/sanitize");
const { setAuthCookies, parseCookies } = require("../utils/httpCookies");
const { resolveChallengeUsername, resolveRequiredAttributes } = require("../utils/cognitoClient");

test("only verified Cognito groups map to application roles", () => {
    assert.deepEqual(
        rolesFromCognitoGroups({ "cognito:groups": ["Admin", "RegistrationOfficer", "Unknown"] }),
        ["ADMINISTRATOR", "REGISTRATION_OFFICER"]
    );
    assert.deepEqual(rolesFromCognitoGroups({ role: "ADMINISTRATOR" }), []);
});

test("Cognito challenges preserve the canonical username instead of an email alias", () => {
    assert.equal(
        resolveChallengeUsername(
            { ChallengeParameters: { USER_ID_FOR_SRP: "89ba757c-60c1-7079-d691-688794814834" } },
            "staff@example.com"
        ),
        "89ba757c-60c1-7079-d691-688794814834"
    );
    assert.equal(
        resolveChallengeUsername(
            {
                ChallengeParameters: {
                    userAttributes: JSON.stringify({
                        sub: "89ba757c-60c1-7079-d691-688794814834",
                        email: "staff@example.com",
                    }),
                },
            },
            "staff@example.com"
        ),
        "89ba757c-60c1-7079-d691-688794814834"
    );
    assert.equal(resolveChallengeUsername({}, "staff@example.com"), "staff@example.com");
});

test("Cognito new-password challenges expose required standard attributes", () => {
    assert.deepEqual(
        resolveRequiredAttributes({
            ChallengeParameters: {
                requiredAttributes: JSON.stringify(["name", "userAttributes.given_name"]),
            },
        }),
        ["name", "given_name"]
    );
    assert.deepEqual(resolveRequiredAttributes({}), []);
});

test("auth cookies are HttpOnly and never expose tokens in a JavaScript response object", () => {
    let values;
    const response = { setHeader(name, value) { if (name === "Set-Cookie") values = value; } };
    setAuthCookies(response, {
        AccessToken: "access-secret",
        RefreshToken: "refresh-secret",
        ExpiresIn: 3600,
    }, "staff@example.com");
    assert.equal(values.length, 3);
    for (const value of values) {
        assert.match(value, /HttpOnly/);
        assert.match(value, /SameSite=Lax/);
    }
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
