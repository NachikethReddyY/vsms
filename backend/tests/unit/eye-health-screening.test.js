const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const screeningService = require("../../services/screening/screeningService");
const { screeningSyncBody } = require("../../schemas/screeningSchemas");

test("eye-health exposes evaluated screening save and preview operations", () => {
  assert.equal(typeof screeningService.previewEyeHealth, "function");
  assert.equal(typeof screeningService.saveEyeHealth, "function");
  assert.equal(screeningService.evaluateEyeHealth({
    cataractRisk: "SUSPECTED",
    glaucomaRisk: "NONE",
    symptomsNoted: false,
    observations: "Lens opacity suspected OD.",
  }).overallFlag, "REVIEW");

  const source = fs.readFileSync(path.join(__dirname, "../../services/screening/screeningService.js"), "utf8");
  assert.doesNotMatch(source, /EYE_HEALTH_REVIEW_ONLY/);
  assert.match(source, /stationType: "EYE_HEALTH"/);
});

test("eye-health is accepted by the offline synchronization contract", () => {
  const result = screeningSyncBody.safeParse({
    clientBatchId: "11111111-1111-4111-8111-111111111111",
    actions: [{
      clientActionId: "22222222-2222-4222-8222-222222222222",
      stationId: "33333333-3333-4333-8333-333333333333",
      stationType: "EYE_HEALTH",
      payload: {
        registrationId: "44444444-4444-4444-8444-444444444444",
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        acknowledged: true,
        resultData: {
          cataractRisk: "SUSPECTED",
          glaucomaRisk: "NONE",
          symptomsNoted: false,
          observations: "Lens opacity suspected OD.",
        },
      },
    }],
  });
  assert.equal(result.success, true);
});
