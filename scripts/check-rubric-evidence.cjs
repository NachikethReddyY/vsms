"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contractPath = path.join(root, "docs", "09-Evidence", "business-objectives.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const provenStatuses = new Set(["AUTOMATED_PROOF", "CONTROL_EVIDENCE", "FIELD_PROOF"]);

assert.equal(contract.schemaVersion, 1);
assert.deepEqual(contract.requirements.map(({ id }) => id), [
  "BR-01", "BR-02", "BR-03", "BR-04", "BR-05", "BR-06", "BR-07", "BR-08",
]);
assert.equal(contract.objectives.length, 7);

const ids = new Set();
for (const item of [...contract.requirements, ...contract.objectives]) {
  assert.match(item.id, /^(BR|BO)-\d{2}$/);
  assert.ok(!ids.has(item.id), `duplicate rubric item: ${item.id}`);
  ids.add(item.id);
  assert.match(item.status, /^[A-Z_]+$/);
  assert.ok(Array.isArray(item.evidence));
  for (const evidence of item.evidence) {
    assert.ok(!path.isAbsolute(evidence), `${item.id} evidence must be repository-relative`);
    assert.ok(fs.existsSync(path.join(root, evidence)), `${item.id} evidence is missing: ${evidence}`);
  }
}

for (const objective of contract.objectives) {
  assert.match(objective.objective, /\S/);
  assert.match(objective.method, /\S/);
  assert.ok(Number.isFinite(objective.target?.value), `${objective.id} needs a numeric target`);
  assert.match(objective.target?.operator || "", /^[A-Z_]+$/);
  assert.match(objective.target?.unit || "", /\S/);
  if (provenStatuses.has(objective.status)) {
    assert.ok(Number.isFinite(objective.actual), `${objective.id} claims proof without a numeric actual`);
    assert.ok(objective.evidence.length > 0, `${objective.id} claims proof without evidence`);
  } else {
    assert.equal(objective.actual, null, `${objective.id} must not claim an unmeasured result`);
  }
}

console.log(`Rubric evidence contract passed (${contract.requirements.length} requirements, ${contract.objectives.length} objectives).`);
