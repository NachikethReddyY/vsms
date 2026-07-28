const { spawnSync } = require("child_process");
const { readFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join, resolve } = require("path");
const { randomUUID } = require("crypto");

const temporary = join(tmpdir(), `vsms-api-${randomUUID()}.ts`);
const generated = resolve(__dirname, "../../react-user-dashboard/src/generated/api.ts");
const generator = resolve(__dirname, "../node_modules/openapi-typescript/bin/cli.js");
const result = spawnSync(process.execPath, [generator, "docs/openapi.yaml", "-o", temporary], {
  cwd: resolve(__dirname, ".."),
  stdio: "inherit",
});

try {
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (readFileSync(temporary, "utf8") !== readFileSync(generated, "utf8")) {
    console.error("Generated frontend API types have drifted. Run npm run contracts:generate.");
    process.exitCode = 1;
  } else {
    console.log("Generated frontend API types match the OpenAPI contract.");
  }
} finally {
  rmSync(temporary, { force: true });
}
