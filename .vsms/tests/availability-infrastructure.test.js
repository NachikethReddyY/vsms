const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const template = fs.readFileSync(path.join(root, "infrastructure/availability.yaml"), "utf8");
const runbook = fs.readFileSync(path.join(root, "docs/07-Operations/availability-runbook.md"), "utf8");

test("production infrastructure retains redundant replaceable services", () => {
  assert.match(template, /HealthCheckPath: \/health/);
  assert.doesNotMatch(template, /HealthCheckPath: \/ready/);
  assert.match(template, /DesiredCount: 2/);
  assert.match(template, /MinimumHealthyPercent: 100/);
  assert.match(template, /DeploymentCircuitBreaker:[\s\S]*?Rollback: true/);
  assert.match(template, /MinCapacity: 2/);
  assert.match(template, /AutomaticFailoverEnabled: true/);
  assert.match(template, /MultiAZEnabled: true/);
  assert.match(template, /ReportWorkerService:[\s\S]*?DesiredCount: 1/);
  assert.match(template, /DomainEventWorkerService:[\s\S]*?DesiredCount: 1/);
});

test("database and frontend recovery data are retained", () => {
  assert.match(template, /Database:[\s\S]*?DeletionPolicy: Snapshot/);
  assert.match(template, /StorageEncrypted: true/);
  assert.match(template, /MultiAZ: true/);
  assert.match(template, /BackupRetentionPeriod: 30/);
  assert.match(template, /DeletionProtection: true/);
  assert.match(template, /FrontendBucket:[\s\S]*?DeletionPolicy: Retain/);
  assert.match(template, /VersioningConfiguration:[\s\S]*?Status: Enabled/);
});

test("secrets are injected rather than placed in normal task environment values", () => {
  for (const name of ["DATABASE_URL", "REDIS_URL", "JWT_ACCESS_SECRET", "ENCRYPTION_KEYRING_JSON"]) {
    assert.match(template, new RegExp(`- Name: ${name}\\n\\s+ValueFrom:`));
    assert.doesNotMatch(template, new RegExp(`- Name: ${name}\\n\\s+Value:`));
  }
  assert.match(template, /DatabaseCredentialsSecret:[\s\S]*?GenerateSecretString:/);
  assert.match(template, /RedisAuthTokenSecret:[\s\S]*?GenerateSecretString:/);
  assert.match(template, /JwtSecret:[\s\S]*?GenerateSecretString:/);
  assert.doesNotMatch(template, /DbMasterPassword:/);
  assert.doesNotMatch(template, /RedisAuthToken:\n/);
  assert.doesNotMatch(template, /JwtAccessSecret:/);
});

test("runbook distinguishes the availability target from measured achievement", () => {
  assert.match(runbook, /objective, not a claim/i);
  assert.match(runbook, /expand-and-contract/i);
  assert.match(runbook, /restore RDS to a new isolated instance/i);
  assert.match(runbook, /quarterly recovery exercise/i);
});
