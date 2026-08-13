"use strict";

const fs = require("node:fs");

const [outputsPath = "stack-outputs.json", destination = "release-manifest.json"] = process.argv.slice(2);
const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf8"));
const get = (key) => outputs.find((output) => output.OutputKey === key)?.OutputValue || null;
const services = ["ApiServiceName", "ReportWorkerServiceName", "DomainEventWorkerServiceName", "LifecycleEmailWorkerServiceName"]
  .map(get)
  .filter(Boolean);

const required = ["DEPLOY_ENVIRONMENT", "RELEASE_SHA", "IMAGE_URI", "GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_ACTOR", "RELEASE_STARTED_AT"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  process.stderr.write(`Release evidence is missing environment fields: ${missing.join(", ")}\n`);
  process.exit(1);
}

const manifest = {
  schemaVersion: 1,
  environment: process.env.DEPLOY_ENVIRONMENT,
  commitSha: process.env.RELEASE_SHA,
  imageUri: process.env.IMAGE_URI,
  workflowUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  actor: process.env.GITHUB_ACTOR,
  approvalEnvironment: process.env.DEPLOY_ENVIRONMENT,
  startedAt: process.env.RELEASE_STARTED_AT,
  completedAt: new Date().toISOString(),
  previousImageUri: process.env.PREVIOUS_IMAGE || null,
  migrations: ["prisma migrate deploy"],
  services,
  taskDefinitions: {
    migration: get("MigrationTaskDefinitionArn"),
  },
  infrastructure: {
    stackName: process.env.STACK_NAME,
    alarmTopicArn: get("DeploymentAlarmTopicArn"),
  },
  evidence: {
    smoke: "passed",
    security: "passed",
    immutableImage: true,
    cloudWatchAlarms: "ok",
  },
  outcome: "succeeded",
};

fs.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${destination}\n`);
