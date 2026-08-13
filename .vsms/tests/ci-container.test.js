const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const dockerfile = fs.readFileSync(path.join(root, ".vsms/Dockerfile.ci"), "utf8");
const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");

test("the local CI image uses the pinned package manager and frozen lockfiles", () => {
  assert.match(dockerfile, /FROM node:24-bookworm-slim/);
  assert.match(dockerfile, /corepack prepare pnpm@11\.20\.0 --activate/);
  assert.equal((dockerfile.match(/install --frozen-lockfile/g) || []).length, 2);
});

test("the CI build context excludes credentials, dependencies, dumps, and generated evidence", () => {
  for (const entry of [".git", "**/node_modules", "**/*.dump", "backend/certs", "secure-data"]) {
    assert.match(dockerignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});
