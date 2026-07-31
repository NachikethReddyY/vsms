const { spawnSync } = require("child_process");
const { readFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join, resolve } = require("path");
const { randomUUID } = require("crypto");

const temporary = join(tmpdir(), `vsms-api-${randomUUID()}.ts`);
const generated = resolve(__dirname, "../../react-user-dashboard/src/generated/api.ts");
const normalizeLineEndings = (value) => value.replace(/\r\n/g, "\n");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCommand, ["openapi-typescript", "docs/openapi.yaml", "-o", temporary], {
  cwd: resolve(__dirname, ".."),
  stdio: "inherit",
  shell: process.platform === "win32",
});

try {
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (
    normalizeLineEndings(readFileSync(temporary, "utf8")) !==
    normalizeLineEndings(readFileSync(generated, "utf8"))
  ) {
    console.error("Generated frontend API types have drifted. Run npm run contracts:generate.");
    process.exitCode = 1;
  } else {
    console.log("Generated frontend API types match the OpenAPI contract.");
  }
} finally {
  rmSync(temporary, { force: true });
}
