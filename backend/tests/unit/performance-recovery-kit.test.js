const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const backend = path.resolve(__dirname, "../..");

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: backend,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("the 500-participant load configuration is accepted without running load", () => {
  const result = run(process.execPath, ["scripts/performance-runner.js", "--check", "--config", "performance/isolated-500.json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /vsms_test/);
});

test("the load runner requires explicit acknowledgement before fixture access or HTTP writes", () => {
  const result = run(process.execPath, ["scripts/performance-runner.js", "--config", "performance/isolated-500.json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /VSMS_LOAD_TEST_ACKNOWLEDGEMENT/);
});

test("restore rejects a non-test database URL before invoking PostgreSQL", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-restore-guard-"));
  const backup = path.join(directory, "fixture.dump");
  fs.writeFileSync(backup, "not a dump");
  fs.writeFileSync(`${backup}.counts.tsv`, "events\t0\n");
  const result = run("sh", ["scripts/restore-postgres-test.sh", backup], {
    RESTORE_DATABASE_URL: "postgresql://user:secret@127.0.0.1:1/vsms",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /URL must end in _test/);
});

test("restore rejects an incomplete row-count manifest before it can clear a test database", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-restore-manifest-"));
  const backup = path.join(directory, "fixture.dump");
  fs.writeFileSync(backup, "not a dump");
  fs.writeFileSync(`${backup}.counts.tsv`, "events\t0\n");
  const result = run("sh", ["scripts/restore-postgres-test.sh", backup], {
    RESTORE_DATABASE_URL: "postgresql://user:secret@127.0.0.1:1/vsms_test",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Manifest must contain every critical table/);
});
