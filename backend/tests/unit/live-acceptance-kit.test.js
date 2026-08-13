const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { assertEvidence, assertKit, loadKit, newEvidence } = require("../../scripts/live-acceptance");
const { assertLocalDemoDatabase, assertResetAcknowledgement, RESET_ACKNOWLEDGEMENT } = require("../../scripts/reset-acceptance-demo");

test("live acceptance kit produces an incomplete, secret-free evidence template", () => {
  const kit = loadKit();
  assertKit(kit);
  const evidence = newEvidence(kit);
  assert.equal(evidence.captures.length, kit.scenarios.length);
  assert.doesNotThrow(() => assertEvidence(evidence, kit, { allowIncomplete: true }));
  assert.throws(() => assertEvidence(evidence, kit), /NOT_RUN/);
});

test("seed anchors synthetic fixture dates and operational event memberships", () => {
  const seed = fs.readFileSync(path.resolve(__dirname, "../../prisma/seed.js"), "utf8");
  assert.match(seed, /VSMS_DEMO_ANCHOR_DATE/);
  assert.match(seed, /SYNTHETIC_ACCEPTANCE_ONLY/);
  assert.match(seed, /ensureDemoMembership\(liveEvent, registrationOfficer, \["REGISTRATION"\]/);
  assert.match(seed, /ensureDemoMembership\(liveEvent, reviewer, \["REVIEWER"\]/);
});

test("live acceptance runner writes and validates a template without network access", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-acceptance-"));
  const evidencePath = path.join(directory, "evidence.json");
  const script = path.resolve(__dirname, "../../scripts/live-acceptance.js");
  execFileSync(process.execPath, [script, "prepare", evidencePath], { stdio: "pipe" });
  execFileSync(process.execPath, [script, "validate", evidencePath, "--allow-incomplete"], { stdio: "pipe" });
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  evidence.captures[0].accessToken = "must-not-be-retained";
  assert.throws(() => assertEvidence(evidence, loadKit(), { allowIncomplete: true }), /not allowed/);
});

test("passed evidence requires run metadata and sanitized capture metadata", () => {
  const kit = structuredClone(loadKit());
  kit.scenarios[0].proofLevel = "DEPENDENCY_BLOCKED";
  const evidence = newEvidence(kit);
  evidence.run = {
    environment: "approved-test",
    migration: { revision: "20260810120000", checkedAt: "2026-08-10T12:00:00.000Z" },
    service: { revision: "build-synthetic", status: "ok", checkedAt: "2026-08-10T12:00:01.000Z" },
  };
  for (const capture of evidence.captures) {
    capture.capturedAt = "2026-08-10T12:01:00.000Z";
    if (capture.proofLevel === "DEPENDENCY_BLOCKED") {
      capture.status = "BLOCKED";
      capture.note = "Known implementation dependency.";
    } else {
      capture.status = "PASSED";
      capture.sanitizedScreenshot = { path: `screenshots/${capture.scenarioId}.png`, sanitized: true };
      capture.requestIds = ["11111111-1111-4111-8111-111111111111"];
      capture.httpStatuses = [200];
      capture.rowCounts = { syntheticRows: 1 };
    }
  }
  assert.doesNotThrow(() => assertEvidence(evidence, kit));
  const dependency = evidence.captures.find((capture) => capture.proofLevel === "DEPENDENCY_BLOCKED");
  dependency.status = "PASSED";
  dependency.sanitizedScreenshot = { path: "screenshots/dependency.png", sanitized: true };
  dependency.requestIds = ["11111111-1111-4111-8111-111111111111"];
  dependency.httpStatuses = [200];
  dependency.rowCounts = { syntheticRows: 1 };
  assert.throws(() => assertEvidence(evidence, kit), /must not validate as PASSED/);
  dependency.status = "BLOCKED";
  const passed = evidence.captures.find((capture) => capture.status === "PASSED");
  passed.httpStatuses = [503];
  assert.throws(() => assertEvidence(evidence, kit), /must not include a 5xx status/);
  passed.httpStatuses = [200];
  evidence.run.service.revision = null;
  assert.throws(() => assertEvidence(evidence, kit), /service revision/);
});

test("acceptance reset rejects every non-local or non-demo database", () => {
  assert.deepEqual(assertLocalDemoDatabase("postgresql://user:pass@localhost:5432/vsms_demo"), {
    host: "localhost",
    database: "vsms_demo",
  });
  assert.throws(() => assertLocalDemoDatabase("postgresql://user:pass@example.com:5432/vsms_demo"), /Refusing reset/);
  assert.throws(() => assertLocalDemoDatabase("postgresql://user:pass@localhost:5432/vsms"), /Refusing reset/);
  assert.doesNotThrow(() => assertResetAcknowledgement(RESET_ACKNOWLEDGEMENT));
  assert.throws(() => assertResetAcknowledgement("reset_local_vsms_demo"), /VSMS_ACCEPTANCE_RESET_ACK/);
  const reset = spawnSync(process.execPath, [path.resolve(__dirname, "../../scripts/reset-acceptance-demo.js")], {
    env: { ...process.env, DATABASE_URL: "postgresql://user:pass@localhost:5432/vsms_demo", VSMS_ACCEPTANCE_RESET_ACK: "wrong" },
    encoding: "utf8",
  });
  assert.equal(reset.status, 1);
  assert.match(reset.stderr, /VSMS_ACCEPTANCE_RESET_ACK/);
});
