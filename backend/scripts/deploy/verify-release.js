"use strict";

const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.resolve(process.argv[2] || process.env.RELEASE_MANIFEST_PATH || "release-manifest.json");
const fail = (message) => {
  process.stderr.write(`Release verification failed: ${message}\n`);
  process.exit(1);
};

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {
  fail("release manifest must exist and contain valid JSON");
}

if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1");
if (!new Set(["staging", "production"]).has(manifest.environment)) fail("environment is invalid");
if (!/^[0-9a-f]{40}$/.test(manifest.commitSha || "")) fail("commitSha must be a full commit SHA");
if (!/@sha256:[0-9a-f]{64}$/.test(manifest.imageUri || "")) fail("imageUri must be immutable");
if (!/^https:\/\/github\.com\//.test(manifest.workflowUrl || "")) fail("workflowUrl must be a GitHub URL");
if (!manifest.actor || !manifest.approvalEnvironment) fail("actor and approvalEnvironment are required");
if (!Number.isFinite(Date.parse(manifest.startedAt)) || !Number.isFinite(Date.parse(manifest.completedAt))) fail("release timestamps are invalid");
if (Date.parse(manifest.completedAt) < Date.parse(manifest.startedAt)) fail("completedAt precedes startedAt");
if (!Array.isArray(manifest.migrations) || !Array.isArray(manifest.services)) fail("migrations and services must be arrays");
if (!manifest.evidence || manifest.evidence.smoke !== "passed" || manifest.evidence.security !== "passed") fail("required release evidence is incomplete");
if (!new Set(["succeeded", "rolled_back"]).has(manifest.outcome)) fail("outcome must be succeeded or rolled_back");

process.stdout.write(`${JSON.stringify({ status: "verified", environment: manifest.environment, outcome: manifest.outcome })}\n`);
