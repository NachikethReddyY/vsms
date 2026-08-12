const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const compose = fs.readFileSync(path.join(root, "backend/docker-compose.test.yml"), "utf8");
const init = fs.readFileSync(path.join(root, "backend/db/init-test-database.sh"), "utf8");

test("local CI database starts with a separate least-privilege application role", () => {
  assert.match(compose, /POSTGRES_USER: postgres/);
  assert.match(compose, /init-test-database\.sh/);
  assert.match(init, /CREATE ROLE vsms_test/);
  assert.match(init, /NOSUPERUSER/);
  assert.match(init, /CREATE DATABASE vsms_test OWNER vsms_test/);
});
