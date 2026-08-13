const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(root, "backend/app.js"), "utf8");
const databaseSource = fs.readFileSync(path.join(root, "backend/config/db.js"), "utf8");

test("health liveness does not depend on the database", () => {
  assert.match(appSource, /app\.get\("\/health", \(_req, res\)/);
  assert.doesNotMatch(appSource, /app\.get\("\/health", async/);

  const livenessSource = appSource.slice(
    appSource.indexOf('app.get("/health"'),
    appSource.indexOf('app.get("/ready"'),
  );
  assert.match(livenessSource, /status: "ok"/);
  assert.doesNotMatch(livenessSource, /db\.query/);
});

test("readiness uses the pg Pool API", () => {
  assert.match(databaseSource, /new Pool\(/);
  assert.match(appSource, /app\.get\("\/ready", async/);
  assert.match(appSource, /await db\.query\("SELECT 1"\)/);
  assert.doesNotMatch(appSource, /db\.\$queryRaw`SELECT 1`/);
});
