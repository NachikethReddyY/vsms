const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const readPortableText = (relativePath) => fs
  .readFileSync(path.join(root, relativePath), "utf8")
  .replace(/\r\n/g, "\n");

const template = readPortableText("infrastructure/availability.yaml");
const runbook = readPortableText("docs/07-Operations/availability-runbook.md");

test("production infrastructure retains redundant replaceable services", () => {
  assert.match(template, /HealthCheckPath: \/health/);
  assert.doesNotMatch(template, /HealthCheckPath: \/ready/);
  assert.match(template, /DesiredCount: !If \[ApplicationServicesAreEnabled, 2, 0\]/);
  assert.match(template, /MinimumHealthyPercent: 100/);
  assert.match(template, /DeploymentCircuitBreaker:[\s\S]*?Rollback: true/);
  assert.match(template, /MinCapacity: !If \[ApplicationServicesAreEnabled, 2, 0\]/);
  assert.match(template, /AutomaticFailoverEnabled: true/);
  assert.match(template, /MultiAZEnabled: true/);
  assert.match(template, /ReportWorkerService:[\s\S]*?DesiredCount: !If \[ApplicationServicesAreEnabled, 1, 0\]/);
  assert.match(template, /DomainEventWorkerService:[\s\S]*?DesiredCount: !If \[ApplicationServicesAreEnabled, 1, 0\]/);
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
  assert.match(template, /DatabaseRuntimeCredentialsSecret:[\s\S]*?"username":"vsms_runtime"/);
  assert.match(template, /DatabaseRuntimeUrlSecret:[\s\S]*?postgresql:\/\/vsms_runtime:/);
  assert.doesNotMatch(template, /ValueFrom: !Ref DatabaseMigrationUrlSecret/);
  assert.match(template, /RedisAuthTokenSecret:[\s\S]*?GenerateSecretString:/);
  assert.match(template, /JwtSecret:[\s\S]*?GenerateSecretString:/);
  assert.doesNotMatch(template, /DbMasterPassword:/);
  assert.doesNotMatch(template, /RedisAuthToken:\n/);
  assert.doesNotMatch(template, /JwtAccessSecret:/);
});

test("ECS has the required Cognito and durable backup boundaries", () => {
  assert.match(template, /- Name: COGNITO_APP_CLIENT_ID\n\s+Value: !Ref CognitoAppClientId/);
  for (const action of [
    "AdminAddUserToGroup",
    "AdminCreateUser",
    "AdminDeleteUser",
    "AdminDisableUser",
    "AdminGetUser",
    "AdminListGroupsForUser",
    "AdminRemoveUserFromGroup",
    "AdminUserGlobalSignOut",
  ]) {
    assert.match(template, new RegExp(`cognito-idp:${action}`));
  }
  assert.match(template, /BackupFileSystem:[\s\S]*?Encrypted: true[\s\S]*?Status: ENABLED/);
  assert.match(template, /TransitEncryption: ENABLED/);
  assert.match(template, /AccessPointId: !Ref BackupAccessPoint/);
  assert.match(template, /ApiService:[\s\S]*?DependsOn:[\s\S]*?- BackupMountTargetA[\s\S]*?- BackupMountTargetB/);
  assert.match(template, /- Name: VSMS_BACKUP_DIR\n\s+Value: \/var\/lib\/vsms\/backups/);
  assert.match(template, /elasticfilesystem:ClientMount/);
  assert.match(template, /elasticfilesystem:ClientWrite/);
});

test("runbook distinguishes the availability target from measured achievement", () => {
  assert.match(runbook, /objective, not a claim/i);
  assert.match(runbook, /expand-and-contract/i);
  assert.match(runbook, /restore RDS to a new isolated instance/i);
  assert.match(runbook, /quarterly recovery exercise/i);
});
