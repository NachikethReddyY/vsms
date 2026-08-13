const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const kitPath = path.join(backendRoot, "acceptance", "live-workflow.json");
const statuses = new Set(["NOT_RUN", "PASSED", "FAILED", "BLOCKED"]);
const proofLevels = new Set(["AUTOMATED_LOCAL", "LIVE_BROWSER", "LIVE_BROWSER_COGNITO", "DEPENDENCY_BLOCKED"]);
const sensitiveKey = /password|secret|token|cookie|authorization|credential/i;
const sensitiveValue = /\S+@\S+|\b[STFG]\d{7}[A-Z]\b|\+\d[\d -]{6,}\d|\b[a-f\d]{64}\b/i;

const loadJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const loadKit = () => loadJson(kitPath);

const assertKit = (kit) => {
  assert.equal(kit.schemaVersion, 1, "unsupported acceptance-kit schema");
  assert.ok(Array.isArray(kit.scenarios) && kit.scenarios.length > 0, "acceptance kit needs scenarios");
  const ids = new Set();
  for (const scenario of kit.scenarios) {
    assert.match(scenario.id, /^[a-z0-9-]+$/, "scenario id must be stable");
    assert.ok(!ids.has(scenario.id), `duplicate scenario id: ${scenario.id}`);
    assert.ok(proofLevels.has(scenario.proofLevel), `unsupported proof level: ${scenario.proofLevel}`);
    assert.equal(typeof scenario.title, "string");
    assert.equal(typeof scenario.expected, "string");
    ids.add(scenario.id);
  }
  for (const required of ["managed-auth-session", "event-duty-boundary", "account-lifecycle-boundary", "registration-qr-checkin", "queue-transfer-and-three-stations", "eye-health-fourth-station", "review-referral", "offline-reconnect", "dashboard-and-export"]) {
    assert.ok(ids.has(required), `missing required scenario: ${required}`);
  }
};

const newEvidence = (kit) => ({
  contractVersion: kit.schemaVersion,
  createdAt: new Date().toISOString(),
  run: {
    environment: "UNSPECIFIED",
    migration: { revision: null, checkedAt: null },
    service: { revision: null, status: null, checkedAt: null },
  },
  captures: kit.scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    proofLevel: scenario.proofLevel,
    status: "NOT_RUN",
    capturedAt: null,
    sanitizedScreenshot: null,
    requestIds: [],
    httpStatuses: [],
    rowCounts: {},
    note: null,
  })),
});

const assertTimestamp = (value, label) => {
  assert.equal(typeof value, "string", `${label} must be an ISO timestamp`);
  assert.ok(!Number.isNaN(Date.parse(value)), `${label} must be an ISO timestamp`);
};

const assertNoSensitiveValues = (value, trail = "evidence") => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveValues(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!sensitiveKey.test(key), `${trail}.${key} is not allowed in acceptance evidence`);
      assertNoSensitiveValues(nested, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    assert.ok(!sensitiveValue.test(value), `${trail} appears to contain a secret or real-looking PII`);
  }
};

const assertCapture = (capture, allowIncomplete) => {
  assert.equal(typeof capture.scenarioId, "string", "capture needs scenarioId");
  assert.ok(statuses.has(capture.status), `unsupported capture status: ${capture.status}`);
  if (capture.status === "NOT_RUN") {
    if (!allowIncomplete) throw new Error(`${capture.scenarioId} is NOT_RUN`);
    return;
  }
  if (capture.status === "BLOCKED" || capture.status === "FAILED") {
    assertTimestamp(capture.capturedAt, `${capture.scenarioId}.capturedAt`);
    assert.match(capture.note || "", /\S/, `${capture.scenarioId} needs an honest note`);
    return;
  }
  assertTimestamp(capture.capturedAt, `${capture.scenarioId}.capturedAt`);
  assert.equal(capture.sanitizedScreenshot?.sanitized, true, `${capture.scenarioId} needs a sanitized screenshot`);
  assert.match(capture.sanitizedScreenshot?.path || "", /\S/, `${capture.scenarioId} needs a screenshot path`);
  assert.ok(Array.isArray(capture.requestIds) && capture.requestIds.length > 0, `${capture.scenarioId} needs request IDs`);
  assert.ok(Array.isArray(capture.httpStatuses) && capture.httpStatuses.length > 0, `${capture.scenarioId} needs HTTP statuses`);
  assert.ok(capture.httpStatuses.every((status) => Number.isInteger(status) && status >= 100 && status < 500), `${capture.scenarioId} passed HTTP evidence must not include a 5xx status`);
  assert.ok(capture.rowCounts && typeof capture.rowCounts === "object" && Object.keys(capture.rowCounts).length > 0, `${capture.scenarioId} needs row counts`);
};

const assertEvidence = (evidence, kit, { allowIncomplete = false } = {}) => {
  assert.equal(evidence.contractVersion, kit.schemaVersion, "evidence contract version does not match kit");
  assertTimestamp(evidence.createdAt, "createdAt");
  assert.ok(Array.isArray(evidence.captures), "evidence needs captures");
  const scenarios = new Map(kit.scenarios.map((scenario) => [scenario.id, scenario]));
  assert.equal(evidence.captures.length, scenarios.size, "evidence must capture every scenario exactly once");
  let hasPassed = false;
  for (const capture of evidence.captures) {
    const scenario = scenarios.get(capture.scenarioId);
    assert.ok(scenario, `unknown scenario: ${capture.scenarioId}`);
    assert.equal(capture.proofLevel, scenario.proofLevel, `${capture.scenarioId} proof level changed`);
    assert.ok(scenario.proofLevel !== "DEPENDENCY_BLOCKED" || capture.status !== "PASSED", `${capture.scenarioId} is dependency-blocked and must not validate as PASSED`);
    assertCapture(capture, allowIncomplete);
    hasPassed ||= capture.status === "PASSED";
    scenarios.delete(capture.scenarioId);
  }
  assert.equal(scenarios.size, 0, "evidence misses a scenario");
  if (hasPassed) {
    assert.match(evidence.run?.environment || "", /\S/, "passed evidence needs an environment label");
    assert.match(evidence.run?.migration?.revision || "", /\S/, "passed evidence needs a migration revision");
    assertTimestamp(evidence.run?.migration?.checkedAt, "migration.checkedAt");
    assert.match(evidence.run?.service?.revision || "", /\S/, "passed evidence needs a service revision");
    assert.match(evidence.run?.service?.status || "", /\S/, "passed evidence needs a service status");
    assertTimestamp(evidence.run?.service?.checkedAt, "service.checkedAt");
  }
  assertNoSensitiveValues(evidence);
};

const usage = () => {
  console.error("Usage: node scripts/live-acceptance.js check | prepare <evidence.json> | validate <evidence.json> [--allow-incomplete]");
  process.exitCode = 1;
};

const main = () => {
  const [command, evidencePath, option] = process.argv.slice(2);
  const kit = loadKit();
  assertKit(kit);
  if (command === "check") {
    assertEvidence(newEvidence(kit), kit, { allowIncomplete: true });
    console.log(`Acceptance kit check passed (${kit.scenarios.length} scenarios; no network calls).`);
    return;
  }
  if (command === "prepare" && evidencePath) {
    const target = path.resolve(evidencePath);
    if (fs.existsSync(target)) throw new Error(`Refusing to overwrite existing evidence: ${target}`);
    if (!fs.existsSync(path.dirname(target))) throw new Error(`Evidence directory does not exist: ${path.dirname(target)}`);
    fs.writeFileSync(target, `${JSON.stringify(newEvidence(kit), null, 2)}\n`, { mode: 0o600 });
    console.log(`Prepared incomplete evidence template: ${target}`);
    return;
  }
  if (command === "validate" && evidencePath) {
    const evidence = loadJson(path.resolve(evidencePath));
    assertEvidence(evidence, kit, { allowIncomplete: option === "--allow-incomplete" });
    console.log(`Evidence contract is valid: ${evidencePath}`);
    return;
  }
  usage();
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Acceptance runner failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { assertEvidence, assertKit, loadKit, newEvidence };
