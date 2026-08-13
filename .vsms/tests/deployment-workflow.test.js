"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const release = fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const environment = fs.readFileSync(path.join(root, ".github/workflows/deploy-environment.yml"), "utf8");
const oidc = fs.readFileSync(path.join(root, "infrastructure/github-oidc-roles.yaml"), "utf8");
const digest = `registry.example/vsms@sha256:${"a".repeat(64)}`;
const sha = "b".repeat(40);

test("release workflow builds once, attests, stages, and then seeks production approval", () => {
  assert.match(release, /permissions:[\s\S]*?id-token: write/);
  assert.match(release, /provenance: mode=max/);
  assert.match(release, /sbom: true/);
  assert.match(release, /actions\/attest@[0-9a-f]{40}/);
  assert.match(release, /image_uri: \$\{\{ needs\.build\.outputs\.image_uri \}\}/g);
  assert.match(release, /production:[\s\S]*?needs: \[build, staging\]/);
  assert.match(release, /docker compose --file backend\/docker-compose\.test\.yml up --detach --wait/);
  assert.match(release, /docker compose --file backend\/docker-compose\.test\.yml down --volumes --remove-orphans/);
  assert.match(release, /pnpm --dir backend db:test:prepare/);
  assert.match(release, /pnpm --dir backend test:integration/);
  assert.match(release, /docker compose --file backend\/docker-compose\.test\.yml down --volumes/);
  assert.doesNotMatch(release, /aws-access-key-id|aws-secret-access-key/i);
});

test("environment deployment migrates before promotion and publishes frontend index last", () => {
  const migration = environment.indexOf("Run one-off expand-and-contract migration");
  const promotion = environment.indexOf("Promote digest to API and workers");
  const assets = environment.indexOf("aws s3 sync");
  const index = environment.indexOf("aws s3 cp react-user-dashboard/dist/index.html");
  assert.ok(migration > 0 && promotion > migration);
  assert.ok(assets > promotion && index > assets);
  assert.match(environment, /if: failure\(\)[\s\S]*?ApiImageUri="\$PREVIOUS_IMAGE"/);
  assert.match(environment, /PREVIOUS_INDEX_VERSION[\s\S]*?--version-id "\$PREVIOUS_INDEX_VERSION"/);
  assert.match(environment, /RELEASE_OUTCOME: rolled_back[\s\S]*?rollback-manifest\.json/);
  assert.match(environment, /SMOKE_AUTH_PATH:[\s\S]*?SMOKE_BEARER_TOKEN:/);
});

test("release manifest helper records the audit evidence without secret values", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-evidence-"));
  const outputs = path.join(temp, "outputs.json");
  const manifest = path.join(temp, "manifest.json");
  fs.writeFileSync(outputs, JSON.stringify([
    { OutputKey: "ApiServiceName", OutputValue: "api" },
    { OutputKey: "ReportWorkerServiceName", OutputValue: "report-worker" },
    { OutputKey: "DomainEventWorkerServiceName", OutputValue: "domain-event-worker" },
    { OutputKey: "MigrationTaskDefinitionArn", OutputValue: "arn:aws:ecs:region:account:task-definition/migration:1" },
    { OutputKey: "DeploymentAlarmTopicArn", OutputValue: "arn:aws:sns:region:account:alarms" },
  ]));
  const result = spawnSync(process.execPath, [path.join(root, "scripts/deploy/write-release-manifest.cjs"), outputs, manifest], {
    encoding: "utf8",
    env: {
      ...process.env,
      DEPLOY_ENVIRONMENT: "staging",
      RELEASE_SHA: sha,
      IMAGE_URI: digest,
      PREVIOUS_IMAGE: digest.replace(/a/g, "c"),
      STACK_NAME: "staging-vsms",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "example/vsms",
      GITHUB_RUN_ID: "123",
      GITHUB_ACTOR: "release-user",
      RELEASE_STARTED_AT: "2026-08-13T00:00:00.000Z",
      SMOKE_BEARER_TOKEN: "must-not-appear",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const body = fs.readFileSync(manifest, "utf8");
  assert.doesNotMatch(body, /must-not-appear/);
  assert.equal(JSON.parse(body).evidence.immutableImage, true);
});

test("OIDC roles bind production to its protected environment and keep duties separate", () => {
  assert.match(oidc, /token\.actions\.githubusercontent\.com:sub: !Sub repo:\$\{GitHubRepository\}:environment:production/);
  assert.match(oidc, /BuildRole:[\s\S]*?ecr:PutImage/);
  assert.match(oidc, /ProductionDeploymentRole:[\s\S]*?cloudformation:ExecuteChangeSet/);
  assert.match(oidc, /ProductionMigrationRole:[\s\S]*?ecs:RunTask/);
  assert.match(oidc, /ProductionVerificationRole:[\s\S]*?cloudwatch:DescribeAlarms/);
  assert.doesNotMatch(oidc, /sts:AssumeRoleWithWebIdentity[\s\S]{0,250}StringLike/);
});
