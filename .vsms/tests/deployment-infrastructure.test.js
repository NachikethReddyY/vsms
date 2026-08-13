"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const template = fs.readFileSync(path.join(root, "infrastructure/availability.yaml"), "utf8").replace(/\r\n/g, "\n");

test("every deployable process uses an immutable release image", () => {
  assert.match(template, /ApiImageUri:[\s\S]*?AllowedPattern: "\.\+@sha256:\[0-9a-f\]\{64\}"/);
  assert.match(template, /CandidateApiImageUri:[\s\S]*?AllowedPattern: "\.\+@sha256:\[0-9a-f\]\{64\}"/);
  assert.match(template, /MigrationTaskDefinition:[\s\S]*?Image: !Ref CandidateApiImageUri/);
  for (const task of ["ApiTaskDefinition", "ReportWorkerTaskDefinition", "DomainEventWorkerTaskDefinition", "LifecycleEmailWorkerTaskDefinition"]) {
    assert.match(template, new RegExp(`${task}:[\\s\\S]*?Image: !Ref ApiImageUri`));
  }
});

test("migration credentials are isolated from application tasks", () => {
  assert.match(template, /MigrationExecutionRole:[\s\S]*?Resource: !Ref DatabaseMigrationUrlSecret/);
  assert.match(template, /MigrationTaskDefinition:[\s\S]*?Command: \["pnpm", "deploy:migrate"\][\s\S]*?ValueFrom: !Ref DatabaseMigrationUrlSecret/);
  const applicationTasks = template.slice(template.indexOf("  ApiTaskDefinition:"), template.indexOf("  ApiLoadBalancer:"));
  assert.doesNotMatch(applicationTasks, /ValueFrom: !Ref DatabaseMigrationUrlSecret/);
  assert.match(applicationTasks, /ValueFrom: !Ref DatabaseRuntimeUrlSecret/);
});

test("application role grants narrow Cognito, SES, SNS, and EFS access", () => {
  assert.match(template, /Resource: !Sub arn:\$\{AWS::Partition\}:cognito-idp:[^\n]+\/\$\{CognitoUserPoolId\}/);
  assert.match(template, /PolicyName: SendVsmsReferralEmail[\s\S]*?Resource: !Ref SesIdentityArn/);
  assert.match(template, /PolicyName: ConfirmVsmsSesSubscriptions[\s\S]*?Resource: !Ref SesSnsTopicArns/);
  assert.match(template, /PolicyName: WriteVsmsBackups[\s\S]*?elasticfilesystem:AccessPointArn/);
  assert.doesNotMatch(template, /Action:\s+['"]?\*['"]?/);
});

test("readiness, release rollback alarms, and operations notifications are declared", () => {
  assert.match(template, /HealthCheckPath: \/ready/);
  assert.match(template, /ApiReadyHealthCheck:[\s\S]*?ResourcePath: \/ready/);
  for (const resource of [
    "Api5xxAlarm",
    "ApiP95LatencyAlarm",
    "ApiUnhealthyTargetAlarm",
    "DatabaseCpuAlarm",
    "DatabaseStorageAlarm",
    "DatabaseConnectionsAlarm",
    "ReportWorkerFailureAlarm",
    "DomainEventWorkerFailureAlarm",
    "DomainEventDeadLetterAlarm",
    "StoppedTaskEventRule",
    "DatabaseAvailabilityEvents",
  ]) {
    assert.match(template, new RegExp(`^  ${resource}:`, "m"));
  }
  assert.match(template, /ApiService:[\s\S]*?Alarms:[\s\S]*?- !Ref Api5xxAlarm/);
  assert.match(template, /DeploymentAlarmTopic:[\s\S]*?KmsMasterKeyId: alias\/aws\/sns/);
});

test("all service and migration identifiers needed by the pipeline are exported", () => {
  for (const output of [
    "ApiClusterName",
    "ApiServiceName",
    "ReportWorkerServiceName",
    "DomainEventWorkerServiceName",
    "MigrationTaskDefinitionArn",
    "PrivateSubnetIds",
    "ApiSecurityGroupId",
    "FrontendBucketName",
    "FrontendDistributionId",
  ]) {
    assert.match(template, new RegExp(`^  ${output}:`, "m"));
  }
});

test("each long-running task receives the production configuration required during module startup", () => {
  for (const task of ["ApiTaskDefinition", "ReportWorkerTaskDefinition", "DomainEventWorkerTaskDefinition", "LifecycleEmailWorkerTaskDefinition"]) {
    const start = template.indexOf(`  ${task}:`);
    const remaining = template.slice(start + 3);
    const nextResource = remaining.search(/\n  [A-Za-z][A-Za-z0-9]+:\n/);
    const definition = template.slice(start, nextResource === -1 ? undefined : start + 3 + nextResource);
    assert.match(definition, /- Name: PUBLIC_APP_ORIGIN\n\s+Value:/, `${task} needs the production public origin`);
    assert.match(definition, /- Name: ENCRYPTION_ACTIVE_KEY_ID\n\s+Value:/, `${task} needs an active encryption key`);
    assert.match(definition, /- Name: DATABASE_URL\n\s+ValueFrom:/, `${task} needs runtime database access`);
    assert.match(definition, /- Name: JWT_ACCESS_SECRET\n\s+ValueFrom:/, `${task} needs production environment validation`);
    assert.match(definition, /- Name: ENCRYPTION_KEYRING_JSON\n\s+ValueFrom:/, `${task} needs the keyring`);
  }
});
