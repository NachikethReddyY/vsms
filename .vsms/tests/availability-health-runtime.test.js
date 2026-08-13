const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

process.env.DATABASE_URL = "postgresql://vsms_test:vsms_test@127.0.0.1:1/vsms_test";
process.env.LOCAL_HTTPS = "false";
process.env.NODE_ENV = "test";

const db = require("../../backend/config/db");

test("liveness stays healthy while database readiness fails", async (t) => {
  let databaseQueries = 0;
  db.query = async () => {
    databaseQueries += 1;
    throw new Error("database unavailable");
  };
  t.after(() => db.end());

  const app = require("../../backend/app");
  const health = await request(app).get("/health");

  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(databaseQueries, 0);

  const readiness = await request(app).get("/ready");

  assert.equal(readiness.status, 503);
  assert.equal(readiness.body.status, "not_ready");
  assert.equal(readiness.body.database, "disconnected");
  assert.equal(databaseQueries, 1);
});
