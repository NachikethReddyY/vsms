"use strict";

const crypto = require("node:crypto");

const isMigration = process.argv.includes("--migration");
const environment = String(process.env.DEPLOY_ENVIRONMENT || "").trim().toLowerCase();
const releaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
const imageUri = String(process.env.RELEASE_IMAGE_URI || "").trim();

const fail = (message) => {
  process.stderr.write(`Deployment preflight failed: ${message}\n`);
  process.exit(1);
};

if (!new Set(["staging", "production"]).has(environment)) fail("DEPLOY_ENVIRONMENT must be staging or production");
if (process.env.NODE_ENV !== "production") fail("NODE_ENV must be production");
if (!/^[0-9a-f]{40}$/.test(releaseSha) || /^0{40}$/.test(releaseSha)) fail("RELEASE_SHA must be a non-zero, full 40-character commit SHA");
if (!/@sha256:[0-9a-f]{64}$/.test(imageUri)) fail("RELEASE_IMAGE_URI must identify an immutable image digest");

if (isMigration) {
  let databaseUrl;
  try {
    databaseUrl = new URL(process.env.DATABASE_URL);
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL URL for the one-off migration task");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) fail("DATABASE_URL must use PostgreSQL");
  if (["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.toLowerCase())) fail("a deployment migration cannot target localhost");
  if (databaseUrl.searchParams.get("sslmode") !== "require") fail("deployment migrations require sslmode=require");
}

process.stdout.write(`${JSON.stringify({
  environment,
  releaseSha,
  imageDigest: imageUri.slice(imageUri.indexOf("@") + 1),
  migration: isMigration,
  preflightId: crypto.createHash("sha256").update(`${environment}:${releaseSha}:${imageUri}`).digest("hex").slice(0, 16),
})}\n`);
