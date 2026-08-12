const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "backend/scripts/prepare-test-database.js"), "utf8");

test("test database preparation invokes pnpm portably", () => {
  assert.match(source, /process\.env\.npm_execpath/);
  assert.match(source, /endsWith\("\.exe"\)/);
  assert.match(source, /process\.env\.ComSpec \|\| "cmd\.exe"/);
  assert.doesNotMatch(source, /const pnpmCommand = process\.platform/);
});
