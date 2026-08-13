const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const dockerfile = fs.readFileSync(path.join(root, "backend/Dockerfile"), "utf8");

test("production image generates Prisma Client from the deployed schema", () => {
  const schemaCopy = dockerfile.indexOf("COPY prisma ./prisma");
  const install = dockerfile.indexOf("pnpm install --frozen-lockfile --prod");
  const generate = dockerfile.indexOf("pnpm prisma:generate");
  const runtimeStage = dockerfile.indexOf("FROM node:24-bookworm-slim AS runtime");

  assert.ok(schemaCopy >= 0, "the Prisma schema must be copied into the dependency stage");
  assert.ok(schemaCopy < install, "the Prisma schema must exist before dependency installation");
  assert.ok(install < generate, "Prisma Client must be generated after dependencies are installed");
  assert.ok(generate < runtimeStage, "the generated client must be copied into the runtime image");
});
