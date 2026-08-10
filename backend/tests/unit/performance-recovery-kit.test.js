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

function completeManifest() {
  return ["events", "participants", "event_registrations", "queue_entries", "screening_results", "sync_actions", "audit_logs"]
    .map((table) => `${table}\t0`)
    .join("\n");
}

function writeTool(directory, name, source) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, source, { mode: 0o755 });
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

test("the load runner refuses remote and forwarded targets without a direct opt-in", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-load-policy-"));
  const config = path.join(directory, "remote.json");
  fs.writeFileSync(config, JSON.stringify({
    target: "remote_test",
    baseUrl: "https://isolated.example.test",
    fixtureFile: "/tmp/vsms-remote-fixture.json",
    participantCount: 1,
    concurrency: 1,
    readSampleSize: 1,
    authorizationEnv: "PERF_AUTHORIZATION",
  }));
  const remote = run(process.execPath, ["scripts/performance-runner.js", "--check", "--config", config]);
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /VSMS_LOAD_TEST_REMOTE_NONPRODUCTION=YES/);
  const forwarded = run(process.execPath, ["scripts/performance-runner.js", "--check", "--config", "performance/isolated-500.json"], {
    HTTPS_PROXY: "http://forwarded.example.test:8080",
  });
  assert.equal(forwarded.status, 1);
  assert.match(forwarded.stderr, /Forward proxy environment variables/);
});

test("fixture preparation requires its exact acknowledgement before loading Prisma", () => {
  const result = run(process.execPath, ["scripts/prepare-performance-fixture.js"], {
    DATABASE_URL: "postgresql://user:secret@127.0.0.1:1/vsms_test",
    PERF_FIXTURE_FILE: path.join(os.tmpdir(), "vsms-fixture-ack.json"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PERF_FIXTURE_CONFIRM=CREATE_SYNTHETIC_TEST_DATA/);
});

test("restore rejects a non-test database URL before invoking PostgreSQL", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-restore-guard-"));
  const backup = path.join(directory, "fixture.dump");
  fs.writeFileSync(backup, "not a dump");
  fs.writeFileSync(`${backup}.counts.tsv`, "events\t0\n");
  const result = run("sh", ["scripts/restore-postgres-test.sh", backup], {
    RESTORE_DATABASE_URL: "postgresql://user:secret@127.0.0.1:1/vsms",
    RESTORE_CONFIRM: "RESTORE_ISOLATED_TEST_DATABASE",
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
    RESTORE_CONFIRM: "RESTORE_ISOLATED_TEST_DATABASE",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Manifest must contain every critical table/);
});

test("restore requires its exact acknowledgement before checking a backup", () => {
  const result = run("sh", ["scripts/restore-postgres-test.sh", "/not/a/real.dump"], {
    RESTORE_DATABASE_URL: "postgresql://user:secret@127.0.0.1:1/vsms_test",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RESTORE_CONFIRM=RESTORE_ISOLATED_TEST_DATABASE/);
});

test("backup refuses an existing same-name output before pg_dump", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-backup-collision-"));
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-backup-tools-"));
  const backup = path.join(directory, "vsms-vsms_test-20260101T000000Z.dump");
  fs.writeFileSync(backup, "existing backup");
  writeTool(tools, "psql", "#!/bin/sh\nprintf '%s\\n' vsms_test\n");
  writeTool(tools, "pg_dump", "#!/bin/sh\nprintf 'pg_dump should not run\\n' >&2\nexit 99\n");
  writeTool(tools, "date", "#!/bin/sh\ncase \"$1\" in -u) printf '%s\\n' 20260101T000000Z ;; *) printf '%s\\n' 1 ;; esac\n");
  const result = run("sh", ["scripts/backup-postgres.sh"], {
    DATABASE_URL: "postgresql://user:secret@127.0.0.1:1/vsms_test",
    VSMS_BACKUP_DIR: directory,
    PATH: `${tools}:/bin:/usr/bin`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to overwrite existing backup/);
  assert.doesNotMatch(result.stderr, /pg_dump should not run/);
});

test("restore passes pg_restore the single-transaction flag", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-restore-transaction-"));
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-restore-tools-"));
  const backup = path.join(directory, "fixture.dump");
  const argumentsFile = path.join(directory, "pg-restore-arguments.txt");
  fs.writeFileSync(backup, "not a real dump");
  fs.writeFileSync(`${backup}.counts.tsv`, `${completeManifest()}\n`);
  writeTool(tools, "psql", "#!/bin/sh\ncase \"$*\" in *current_database*) printf '%s\\n' vsms_test ;; *) printf '%s\\n' 0 ;; esac\n");
  writeTool(tools, "pg_restore", "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PG_RESTORE_ARGUMENTS_FILE\"\n");
  const result = run("sh", ["scripts/restore-postgres-test.sh", backup], {
    RESTORE_DATABASE_URL: "postgresql://user:secret@127.0.0.1:1/vsms_test",
    RESTORE_CONFIRM: "RESTORE_ISOLATED_TEST_DATABASE",
    PG_RESTORE_ARGUMENTS_FILE: argumentsFile,
    PATH: `${tools}:/bin:/usr/bin`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(argumentsFile, "utf8"), /^--single-transaction$/m);
});
