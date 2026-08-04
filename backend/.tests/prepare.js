require("dotenv").config();
const { spawnSync } = require("node:child_process");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const testEnvironment = (databaseUrl = process.env.DATABASE_URL) => ({
  ...process.env,
  ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  NODE_ENV: "test",
  LOCAL_HTTPS: "false",
});

const run = (command, args, env = testEnvironment()) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
};

// Keep the integration command as the single CI gate: all maintained unit
// suites plus the filesystem/API security contracts run before touching a DB.
run(pnpm, ["exec", "prisma", "generate"]);
run(pnpm, ["test"]);
run("node", [
  "--test",
  ".tests/contracts.test.js",
  ".tests/security.test.js",
  ".tests/validation.test.js",
  ".tests/stationTemplateMapping.test.js",
  ".tests/screeningService.test.js",
]);

const url = new URL(process.env.DATABASE_URL);
if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
if (!url.pathname.endsWith("_test")) throw new Error("Refusing to prepare a database without an _test suffix");
const databaseEnvironment = testEnvironment(url.toString());

// `migrate reset` is intentionally guarded by the `_test` suffix above. This
// makes stale fixtures and migration-order defects reproducible locally and in
// CI instead of depending on whichever schema happened to exist beforehand.
run(pnpm, ["exec", "prisma", "migrate", "reset", "--force", "--skip-seed"], databaseEnvironment);

run(pnpm, [
  "exec",
  "vitest",
  "run",
  "--fileParallelism=false",
  "--maxWorkers=1",
  ".tests/auth.integration.test.js",
  ".tests/events.integration.test.js",
  ".tests/reviews.integration.test.js",
  ".tests/locationService.test.js",
  ".tests/reviewService.test.js",
  ".tests/sync.integration.test.js",
], databaseEnvironment);
