const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const screeningService = require("../../services/screening/screeningService");

test("eye-health screener preview and save paths are blocked as review-only", () => {
  assert.throws(
    () => screeningService.previewEyeHealth("event", "station", {}, { userId: "u" }),
    (error) => error.code === "EYE_HEALTH_REVIEW_ONLY" && error.status === 410,
  );
  assert.throws(
    () => screeningService.saveEyeHealth("event", "station", {}, { userId: "u" }, {}),
    (error) => error.code === "EYE_HEALTH_REVIEW_ONLY" && error.status === 410,
  );
});
