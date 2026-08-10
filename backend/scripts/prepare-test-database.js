const { execFileSync } = require("node:child_process");
const path = require("node:path");
const dotenv = require("dotenv");

const backendRoot = path.resolve(__dirname, "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const integrationTestArgs = ["--test", "tests/integration/*.test.js", "tests/security/rateLimit.test.js", "tests/security/rbac.test.js"];

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

const run = (command, args) => execFileSync(command, args, { cwd: backendRoot, stdio: "inherit" });

const prepareTestDatabase = () => {
  dotenv.config({ path: path.join(backendRoot, ".env.test") });
  const databaseName = testDatabaseName(process.env.DATABASE_URL);
  console.log(`Preparing isolated integration database ${databaseName}.`);
  run(pnpmCommand, ["prisma:generate"]);
  run(pnpmCommand, ["exec", "prisma", "migrate", "reset", "--force", "--skip-seed"]);
};

if (require.main === module) {
  prepareTestDatabase();
  if (process.argv.includes("--run-tests")) run(process.execPath, integrationTestArgs);
}

module.exports = { prepareTestDatabase, testDatabaseName };
