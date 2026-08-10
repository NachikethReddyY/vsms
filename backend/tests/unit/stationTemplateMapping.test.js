const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SUPPORTED_SCREENING_STATION_TYPES,
  stationTypeForTemplate,
  classifyTemplates,
} = require("../../services/event/stationTemplateMapping");

test("supported screening station types match StationType enum", () => {
  assert.deepEqual([...SUPPORTED_SCREENING_STATION_TYPES].sort(), [
    "COLOUR_VISION",
    "EYE_HEALTH",
    "REFRACTION",
    "VISUAL_ACUITY",
  ]);
  for (const stationType of SUPPORTED_SCREENING_STATION_TYPES) {
    assert.equal(stationTypeForTemplate({ templateKey: "opaque", stationType }), stationType);
  }
});

test("legacy templates without stationType stay catalog-only", () => {
  assert.equal(stationTypeForTemplate({ templateKey: "REGISTRATION", stationType: null }), null);
  assert.equal(stationTypeForTemplate({ templateKey: "CLINICAL_REVIEW" }), null);
});

test("classifyTemplates separates importable and skipped templates", () => {
  const templates = [
    { templateKey: "REGISTRATION", stationType: null, stationTemplateId: "1" },
    { templateKey: "opaque-1", stationType: "VISUAL_ACUITY", stationTemplateId: "2" },
    { templateKey: "CLINICAL_REVIEW", stationType: null, stationTemplateId: "3" },
    { templateKey: "opaque-2", stationType: "REFRACTION", stationTemplateId: "4" },
    { templateKey: "UNKNOWN_KEY", stationType: null, stationTemplateId: "5" },
  ];
  const { importable, skipped } = classifyTemplates(templates);
  assert.deepEqual(
    importable.map(({ template, stationType }) => [template.stationTemplateId, stationType]),
    [["2", "VISUAL_ACUITY"], ["4", "REFRACTION"]],
  );
  assert.deepEqual(
    skipped.map((template) => template.templateKey),
    ["REGISTRATION", "CLINICAL_REVIEW", "UNKNOWN_KEY"],
  );
});
