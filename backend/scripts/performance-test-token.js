#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  throw new Error(message);
}

function main() {
  if (process.env.NODE_ENV !== "test") fail("Performance test tokens are available only with NODE_ENV=test");
  if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32) fail("JWT_ACCESS_SECRET must be set to at least 32 characters");
  const fixtureFile = process.env.PERF_FIXTURE_FILE;
  if (!fixtureFile || !path.isAbsolute(fixtureFile)) fail("PERF_FIXTURE_FILE must be an absolute path");
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  if (!UUID.test(fixture.actorId)) fail("Fixture does not contain a valid actorId");
  process.stdout.write(jwt.sign({ type: "access" }, process.env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: fixture.actorId,
    issuer: process.env.JWT_ISSUER || "vsms-api",
    audience: process.env.JWT_AUDIENCE || "vsms-dashboard",
    expiresIn: "15m",
  }));
}

try {
  main();
} catch (error) {
  process.stderr.write(`Cannot mint performance test token: ${error.message}\n`);
  process.exitCode = 1;
}
