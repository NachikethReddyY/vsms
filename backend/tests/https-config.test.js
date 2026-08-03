const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const backend = path.resolve(__dirname, "..");

function loadConfig(overrides) {
  return spawnSync(process.execPath, ["-e", "require('./config/env')"], {
    cwd: backend,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/vsms_test",
      ...overrides,
    },
    encoding: "utf8",
  });
}

test("transport configuration rejects HTTP origins and Cognito URLs", () => {
  for (const overrides of [
    { CORS_ORIGINS: "http://localhost:5173" },
    { CORS_ORIGINS: "https://localhost:5173", COGNITO_REDIRECT_URI: "http://localhost:5173/auth/callback" },
  ]) {
    assert.notEqual(loadConfig(overrides).status, 0);
  }

  assert.equal(loadConfig({
    CORS_ORIGINS: "https://localhost:5173",
    COGNITO_REDIRECT_URI: "https://localhost:5173/auth/callback",
  }).status, 0);
});
