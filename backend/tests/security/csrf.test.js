const assert = require("node:assert/strict");
const test = require("node:test");
const cookieParser = require("cookie-parser");
const express = require("express");
const request = require("supertest");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
process.env.CORS_ORIGINS ||= "https://localhost:5173";

const csrf = require("../../middlewares/csrf");
const app = express();
app.use(cookieParser());
app.post("/mutation", csrf, (_req, res) => res.sendStatus(204));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));

test("cookie mutations require matching same-origin CSRF tokens", async () => {
    const denied = await request(app)
        .post("/mutation")
        .set("Origin", "https://localhost:5173")
        .set("Cookie", "vsms_csrf=cookie-token")
        .set("X-CSRF-Token", "wrong-token");
    assert.equal(denied.status, 403);

    const accepted = await request(app)
        .post("/mutation")
        .set("Origin", "https://localhost:5173")
        .set("Cookie", "vsms_csrf=same-token")
        .set("X-CSRF-Token", "same-token");
    assert.equal(accepted.status, 204);
});

test("Bearer-token API mutations do not require browser CSRF cookies", async () => {
    const response = await request(app)
        .post("/mutation")
        .set("Authorization", "Bearer header.payload.signature");
    assert.equal(response.status, 204);
});

test("a dummy bearer header cannot bypass CSRF while an access cookie is present", async () => {
    const denied = await request(app)
        .post("/mutation")
        .set("Authorization", "Bearer dummy.header.signature")
        .set("Origin", "https://localhost:5173")
        .set("Cookie", "vsms_access=real-cookie-session; vsms_csrf=cookie-token");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "CSRF_VALIDATION_FAILED");
});
