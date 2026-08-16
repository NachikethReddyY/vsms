"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const template = fs.readFileSync(path.join(root, "infrastructure/availability.yaml"), "utf8").replace(/\r\n/g, "\n");

test("runtime and candidate images are immutable digests", () => {
  assert.match(template, /ApiImageUri:[\s\S]*?AllowedPattern: "\.\+@sha256:\[0-9a-f\]\{64\}"/);
  assert.match(template, /CandidateApiImageUri:[\s\S]*?AllowedPattern: "\.\+@sha256:\[0-9a-f\]\{64\}"/);
  assert.match(template, /MigrationTaskDefinition:[\s\S]*?Image: !Ref CandidateApiImageUri/);
  for (const task of ["ApiTaskDefinition", "ReportWorkerTaskDefinition", "DomainEventWorkerTaskDefinition"]) {
    assert.match(template, new RegExp(`${task}:[\\s\\S]*?Image: !Ref ApiImageUri`));
  }
});

test("migration credentials are available only to the one-off task", () => {
  assert.match(template, /MigrationExecutionRole:[\s\S]*?Resource: !Ref DatabaseMigrationUrlSecret/);
  assert.match(template, /MigrationTaskDefinition:[\s\S]*?Command: \["pnpm", "deploy:migrate"\][\s\S]*?ValueFrom: !Ref DatabaseMigrationUrlSecret/);
  const runtime = template.slice(template.indexOf("  ApiTaskDefinition:"), template.indexOf("  ApiLoadBalancer:"));
  assert.doesNotMatch(runtime, /ValueFrom: !Ref DatabaseMigrationUrlSecret/);
  assert.match(runtime, /ValueFrom: !Ref DatabaseRuntimeUrlSecret/);
});

test("the release workflow can discover every migration and service target", () => {
  for (const output of [
    "ApiClusterName",
    "ApiServiceName",
    "ReportWorkerServiceName",
    "DomainEventWorkerServiceName",
    "MigrationTaskDefinitionArn",
    "PrivateSubnetIds",
    "ApiSecurityGroupId",
    "DatabaseIdentifier",
    "FrontendBucketName",
    "FrontendDistributionId",
  ]) {
    assert.match(template, new RegExp(`^  ${output}:`, "m"));
  }
});

test("application services retain rolling rollback and readiness controls", () => {
  assert.match(template, /HealthCheckPath: \/ready/);
  assert.match(template, /ApiService:[\s\S]*?MinimumHealthyPercent: 100[\s\S]*?Rollback: true/);
  assert.match(template, /DesiredCount: !If \[ApplicationServicesAreEnabled, 2, 0\]/);
});
