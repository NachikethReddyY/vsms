"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const backend = path.join(root, "backend");
const deployScripts = path.join(backend, "scripts", "deploy");
const digest = `registry.example/vsms@sha256:${"a".repeat(64)}`;
const sha = "b".repeat(40);

function run(script, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(deployScripts, script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("package commands separate deployment operations and guard unsafe database changes", () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(backend, "package.json"), "utf8"));

  assert.equal(scripts.deploy, undefined);
  assert.equal(scripts["deploy:prod"], undefined);
  assert.equal(scripts["db:setup"], undefined);
  assert.match(scripts["setup:demo"], /assert-non-production/);
  for (const name of ["prisma:push", "prisma:seed", "seed"]) {
    assert.match(scripts[name], /assert-non-production/, `${name} must refuse production execution`);
  }
  assert.equal(scripts["deploy:migrate"], "node scripts/deploy/preflight.js --migration && prisma migrate deploy");
});

test("demo and destructive database commands are refused in production", () => {
  const result = run("assert-non-production.js", [], { NODE_ENV: "production" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to run/);
});

test("deployment preflight accepts a digest-pinned release", () => {
  const result = run("preflight.js", [], {
    NODE_ENV: "production",
    DEPLOY_ENVIRONMENT: "staging",
    RELEASE_SHA: sha,
    RELEASE_IMAGE_URI: digest,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    environment: "staging",
    releaseSha: sha,
    imageDigest: `sha256:${"a".repeat(64)}`,
    migration: false,
    preflightId: JSON.parse(result.stdout).preflightId,
  });
});

test("deployment preflight rejects mutable image tags", () => {
  const result = run("preflight.js", [], {
    NODE_ENV: "production",
    DEPLOY_ENVIRONMENT: "production",
    RELEASE_SHA: sha,
    RELEASE_IMAGE_URI: "registry.example/vsms:latest",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /immutable image digest/);
});

test("migration preflight requires a remote TLS database URL", () => {
  const common = {
    NODE_ENV: "production",
    DEPLOY_ENVIRONMENT: "production",
    RELEASE_SHA: sha,
    RELEASE_IMAGE_URI: digest,
  };
  const local = run("preflight.js", ["--migration"], {
    ...common,
    DATABASE_URL: "postgresql://user:secret@localhost:5432/vsms?sslmode=require",
  });
  const noTls = run("preflight.js", ["--migration"], {
    ...common,
    DATABASE_URL: "postgresql://user:secret@db.example:5432/vsms",
  });

  assert.equal(local.status, 1);
  assert.match(local.stderr, /cannot target localhost/);
  assert.equal(noTls.status, 1);
  assert.match(noTls.stderr, /sslmode=require/);
});

test("release verification accepts complete evidence and rejects mutable images", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-release-"));
  const manifestPath = path.join(temp, "release.json");
  const manifest = {
    schemaVersion: 1,
    environment: "staging",
    commitSha: sha,
    imageUri: digest,
    workflowUrl: "https://github.com/example/vsms/actions/runs/1",
    actor: "release-user",
    approvalEnvironment: "staging",
    startedAt: "2026-08-13T00:00:00.000Z",
    completedAt: "2026-08-13T00:01:00.000Z",
    migrations: ["202608130001_expand"],
    services: ["api", "report-worker", "domain-event-worker"],
    evidence: { smoke: "passed", security: "passed" },
    outcome: "succeeded",
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const valid = run("verify-release.js", [manifestPath]);
  assert.equal(valid.status, 0, valid.stderr);

  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, imageUri: "registry.example/vsms:latest" }));
  const invalid = run("verify-release.js", [manifestPath]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /imageUri must be immutable/);
});

test("release verification requires a reason for rollback evidence", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-rollback-"));
  const manifestPath = path.join(temp, "release.json");
  const manifest = {
    schemaVersion: 1,
    environment: "production",
    commitSha: sha,
    imageUri: digest,
    workflowUrl: "https://github.com/example/vsms/actions/runs/2",
    actor: "release-user",
    approvalEnvironment: "production",
    startedAt: "2026-08-13T00:00:00.000Z",
    completedAt: "2026-08-13T00:01:00.000Z",
    migrations: ["prisma migrate deploy"],
    services: ["api"],
    evidence: { smoke: "failed_or_not_reached", security: "passed" },
    outcome: "rolled_back",
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const missingReason = run("verify-release.js", [manifestPath]);
  assert.equal(missingReason.status, 1);
  assert.match(missingReason.stderr, /rollback reason/);

  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, rollback: { reason: "readiness failed" } }));
  const complete = run("verify-release.js", [manifestPath]);
  assert.equal(complete.status, 0, complete.stderr);
});
