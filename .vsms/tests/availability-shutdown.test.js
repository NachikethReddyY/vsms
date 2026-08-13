const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const server = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const prismaClient = fs.readFileSync(path.join(root, "backend/prisma/prismaClient.js"), "utf8");

test("one server-owned shutdown path drains every shared resource", () => {
  assert.match(server, /await closeHttpServer\(\)/);
  assert.match(server, /prisma\.\$disconnect\(\)/);
  assert.match(server, /db\.end\(\)/);
  assert.match(server, /closeRateLimiterClient\(\)/);
  assert.match(server, /process\.once\("SIGTERM"/);
});

test("the Prisma singleton does not race the server signal handler", () => {
  assert.doesNotMatch(prismaClient, /process\.on\("SIG(?:INT|TERM)"/);
  assert.doesNotMatch(prismaClient, /process\.exit/);
});
