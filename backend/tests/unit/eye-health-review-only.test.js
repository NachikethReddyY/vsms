const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const screeningService = require("../../services/screening/screeningService");

test("eye-health remains a dedicated screener station", () => {
  assert.equal(typeof screeningService.previewEyeHealth, "function");
  assert.equal(typeof screeningService.saveEyeHealth, "function");
  assert.equal(screeningService.evaluateEyeHealth({
    cataractRisk: "SUSPECTED",
    glaucomaRisk: "NONE",
    symptomsNoted: false,
    observations: "Synthetic observation",
  }).overallFlag, "REVIEW");
});
