const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
process.env.COGNITO_REGION = "us-east-1";
process.env.COGNITO_USER_POOL_ID = "us-east-1_test";
process.env.COGNITO_APP_CLIENT_ID = "test-client";
process.env.COGNITO_DOMAIN = "https://vsms.auth.us-east-1.amazoncognito.com";
process.env.COGNITO_REDIRECT_URI = "https://localhost:5173/auth/callback";
process.env.COGNITO_LOGOUT_URI = "https://localhost:5173";

const app = require("../app");

test("logout clears browser auth without requiring a valid access token", async () => {
    const response = await request(app)
        .post("/api/v1/auth/logout")
        .set("Origin", "https://localhost:5173")
        .set("Cookie", "vsms_csrf=test-token")
        .set("X-CSRF-Token", "test-token")
        .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.logoutUrl, "https://vsms.auth.us-east-1.amazoncognito.com/logout?client_id=test-client&logout_uri=https%3A%2F%2Flocalhost%3A5173");
    assert.ok(response.headers["set-cookie"].every((value) => value.includes("Max-Age=0")));
});

test("global logout requires an access session and still clears browser auth", async () => {
    const response = await request(app)
        .post("/api/v1/auth/global-logout")
        .set("Origin", "https://localhost:5173")
        .set("Cookie", "vsms_csrf=test-token")
        .set("X-CSRF-Token", "test-token")
        .send({});

    assert.equal(response.status, 401);
    assert.ok(response.headers["set-cookie"].every((value) => value.includes("Max-Age=0")));
});

test("logout does not clear cookies when CSRF validation rejects the request", async () => {
    const response = await request(app)
        .post("/api/v1/auth/logout")
        .set("Origin", "https://localhost:5173")
        .set("Cookie", "vsms_csrf=test-token")
        .send({});

    assert.equal(response.status, 403);
    assert.equal(response.body.code, "CSRF_VALIDATION_FAILED");
    assert.equal(response.headers["set-cookie"], undefined);
});

test("logout does not wait for Cognito global sign-out", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Promise(() => {});

    try {
        const response = await request(app)
            .post("/api/v1/auth/logout")
            .set("Origin", "https://localhost:5173")
            .set("Sec-Fetch-Site", "same-origin")
            .set("Cookie", "vsms_access=test-token; vsms_csrf=test-token")
            .set("X-CSRF-Token", "test-token");

        assert.equal(response.status, 200);
        assert.ok(response.headers["set-cookie"].every((value) => value.includes("Max-Age=0")));
    } finally {
        global.fetch = originalFetch;
    }
});

test("global logout waits for Cognito revocation before confirming success", async () => {
    const originalFetch = global.fetch;
    let target;
    global.fetch = async (_url, options) => {
        target = options.headers["X-Amz-Target"];
        return { ok: true, json: async () => ({}) };
    };

    try {
        const response = await request(app)
            .post("/api/v1/auth/global-logout")
            .set("Origin", "https://localhost:5173")
            .set("Cookie", "vsms_access=test-token; vsms_csrf=test-token")
            .set("X-CSRF-Token", "test-token");

        assert.equal(response.status, 200);
        assert.equal(target, "AWSCognitoIdentityProviderService.GlobalSignOut");
        assert.ok(response.headers["set-cookie"].every((value) => value.includes("Max-Age=0")));
    } finally {
        global.fetch = originalFetch;
    }
});

test("global logout surfaces Cognito revocation failure after clearing browser auth", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: false,
        json: async () => ({ __type: "InternalErrorException", message: "Unavailable" }),
    });

    try {
        const response = await request(app)
            .post("/api/v1/auth/global-logout")
            .set("Origin", "https://localhost:5173")
            .set("Cookie", "vsms_access=test-token; vsms_csrf=test-token")
            .set("X-CSRF-Token", "test-token");

        assert.equal(response.status, 502);
        assert.ok(response.headers["set-cookie"].every((value) => value.includes("Max-Age=0")));
    } finally {
        global.fetch = originalFetch;
    }
});
