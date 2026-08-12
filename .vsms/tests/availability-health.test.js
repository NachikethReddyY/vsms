const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(root, "backend/app.js"), "utf8");
const databaseSource = fs.readFileSync(path.join(root, "backend/config/db.js"), "utf8");

test("health readiness uses the pg Pool API", () => {
  assert.match(databaseSource, /new Pool\(/);
  assert.match(appSource, /await db\.query\("SELECT 1"\)/);
  assert.doesNotMatch(appSource, /db\.\$queryRaw`SELECT 1`/);
});
