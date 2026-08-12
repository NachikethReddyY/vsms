const { execFileSync } = require("node:child_process");
const path = require("node:path");
const dotenv = require("dotenv");

const backendRoot = path.resolve(__dirname, "..");
const integrationTestArgs = ["--test", "tests/integration/*.test.js", "tests/security/rateLimit.test.js", "tests/security/rbac.test.js"];
const resetAcknowledgement = "I_UNDERSTAND_THIS_RESETS_A_TEST_DATABASE";

const testDatabaseName = (databaseUrl) => {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Integration database setup refused: DATABASE_URL must be a valid PostgreSQL URL for a database ending in _test.");
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error("Integration database setup refused: DATABASE_URL must contain a valid database name ending in _test.");
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !parsed.hostname
    || !databaseName
    || databaseName.includes("/")
    || !databaseName.endsWith("_test")
  ) {
    throw new Error("Integration database setup refused: DATABASE_URL must name a PostgreSQL database ending in _test.");
  }

  return databaseName;
};

const assertResetAcknowledgement = (value) => {
  if (value !== resetAcknowledgement) {
    throw new Error("Integration database setup refused: set VSMS_TEST_DATABASE_RESET_ACKNOWLEDGEMENT to the required exact acknowledgement.");
  }
};

const run = (command, args) => execFileSync(command, args, { cwd: backendRoot, stdio: "inherit" });

const runPnpm = (args) => {
  if (process.env.npm_execpath) {
    return process.env.npm_execpath.toLowerCase().endsWith(".exe")
      ? run(process.env.npm_execpath, args)
      : run(process.execPath, [process.env.npm_execpath, ...args]);
  }
  if (process.platform === "win32") {
    return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args]);
  }
  return run("pnpm", args);
};

const prepareTestDatabase = () => {
  dotenv.config({ path: path.join(backendRoot, ".env.test") });
  const databaseName = testDatabaseName(process.env.DATABASE_URL);
  assertResetAcknowledgement(process.env.VSMS_TEST_DATABASE_RESET_ACKNOWLEDGEMENT);
  console.log(`Preparing isolated integration database ${databaseName}.`);
  runPnpm(["prisma:generate"]);
  runPnpm(["exec", "prisma", "migrate", "reset", "--force", "--skip-seed"]);
};

if (require.main === module) {
  prepareTestDatabase();
  if (process.argv.includes("--run-tests")) run(process.execPath, integrationTestArgs);
}

module.exports = { assertResetAcknowledgement, prepareTestDatabase, resetAcknowledgement, testDatabaseName };
