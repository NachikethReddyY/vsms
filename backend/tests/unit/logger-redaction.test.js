const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("startup error messages and stacks are redacted while safe fields remain", () => {
  const secret = "startup-sensitive-token";
  const script = `
    const logger = require("./utils/logging/logger/logger");
    const error = new Error(${JSON.stringify(`startup failed: ${secret}`)});
    error.stack += ${JSON.stringify(`\ncaused by ${secret}`)};
    logger.error("startup_failure", {
      event: "startup.failure",
      code: "STARTUP_CONFIG_INVALID",
      message: error.message,
      stack: error.stack,
      authorization: ${JSON.stringify(`Bearer ${secret}`)},
      email: ${JSON.stringify(`${secret}@example.test`)},
    });
    logger.flush();
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://test:test@localhost:5432/vsms_test",
      NODE_ENV: "test",
      LOG_LEVEL: "info",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /startup\.failure/);
  assert.match(result.stdout, /STARTUP_CONFIG_INVALID/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

test("request paths do not bypass Pino with console error or warning logs", () => {
  const files = [
    "../../app.js",
    "../../middlewares/idempotency.js",
    "../../controllers/userController.js",
    "../../utils/qr/qrGenerator.js",
    "../../middlewares/validate.js",
  ];

  for (const file of files) {
    const source = readFileSync(path.resolve(__dirname, file), "utf8");
    assert.doesNotMatch(source, /console\.(?:error|warn|log)\s*\(/, file);
  }
});
