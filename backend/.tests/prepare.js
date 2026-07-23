require("dotenv").config();
const { spawnSync } = require("child_process");

const url = new URL(process.env.DATABASE_URL);
if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
if (!url.pathname.endsWith("_test")) throw new Error("Refusing to prepare a database without an _test suffix");

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", LOCAL_HTTPS: "false" },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);

const tests = spawnSync("npx", ["vitest", "run", ".tests"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", LOCAL_HTTPS: "false" },
  stdio: "inherit",
});
process.exit(tests.status || 0);
