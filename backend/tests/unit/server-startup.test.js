const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
process.env.NODE_ENV = "test";
process.env.LOCAL_HTTPS = "false";

test("server module loads without undeclared runtime dependencies", () => {
  const { server } = require("../../server");
  assert.equal(typeof server.listen, "function");
});
