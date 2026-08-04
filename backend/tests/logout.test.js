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
