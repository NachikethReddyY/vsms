const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const express = require("express");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const env = require("../../config/env");

test("the JSON parser enforces the configured request body limit", async () => {
    assert.equal(env.requestBodyLimit, "256kb");
    const appSource = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
    assert.match(appSource, /limit:\s*env\.requestBodyLimit/);

    const body = Buffer.from(JSON.stringify({ data: "x".repeat(256 * 1024) }));
    const req = Object.assign(Readable.from([body]), {
        headers: { "content-type": "application/json", "content-length": String(body.length) },
        method: "POST",
        url: "/",
    });
    const error = await new Promise((resolve) => {
        express.json({ limit: env.requestBodyLimit, strict: true, type: "application/json" })(req, {}, resolve);
    });
    assert.equal(error.status, 413);
});
