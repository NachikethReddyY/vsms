const assert = require("node:assert/strict");
const test = require("node:test");

const { assertResetAcknowledgement, resetAcknowledgement, testDatabaseName } = require("../../scripts/prepare-test-database");

test("integration database preparation accepts only parsed PostgreSQL _test database names", () => {
  assert.equal(
    testDatabaseName("postgresql://vsms_test:password@127.0.0.1:5433/vsms_test?schema=public"),
    "vsms_test",
  );

  for (const databaseUrl of [
    undefined,
    "not-a-url",
    "https://localhost/vsms_test",
    "postgresql:///vsms_test",
    "postgresql://localhost/vsms_dev",
    "postgresql://localhost/vsms_test/other",
    "postgresql://localhost/vsms%2F_test",
  ]) {
    assert.throws(() => testDatabaseName(databaseUrl), /Integration database setup refused/);
  }
});

test("integration database preparation requires an exact reset acknowledgement", () => {
  assert.throws(() => assertResetAcknowledgement(), /Integration database setup refused/);
  assert.throws(() => assertResetAcknowledgement("reset-vsms_test"), /Integration database setup refused/);
  assert.doesNotThrow(() => assertResetAcknowledgement(resetAcknowledgement));
});
