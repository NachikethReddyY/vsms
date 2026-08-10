const { spawnSync } = require("node:child_process");

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const assertLocalDemoDatabase = (databaseUrl) => {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!localHosts.has(url.hostname) || !["vsms_demo", "vsms_acceptance_demo"].includes(database)) {
    throw new Error("Refusing reset: DATABASE_URL must target local vsms_demo or vsms_acceptance_demo");
  }
  return { host: url.hostname, database };
};

const main = () => {
  const target = assertLocalDemoDatabase(process.env.DATABASE_URL);
  console.log(`Resetting local acceptance database ${target.host}/${target.database}.`);
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "reset", "--force"], {
    cwd: __dirname + "/..",
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Acceptance reset failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { assertLocalDemoDatabase };
