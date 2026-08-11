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
    "CUSTOM",
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
  assert.equal(stationTypeForTemplate({ templateKey: "EYE_HEALTH", stationType: "EYE_HEALTH" }), null);
});

test("classifyTemplates separates importable and skipped templates", () => {
  const templates = [
    { templateKey: "REGISTRATION", stationType: null, stationTemplateId: "1" },
    { templateKey: "opaque-1", stationType: "VISUAL_ACUITY", stationTemplateId: "2" },
    { templateKey: "CLINICAL_REVIEW", stationType: null, stationTemplateId: "3" },
    { templateKey: "opaque-2", stationType: "REFRACTION", stationTemplateId: "4" },
    { templateKey: "UNKNOWN_KEY", stationType: null, stationTemplateId: "5" },
    { templateKey: "CUSTOM_OD_NOTES", stationType: "CUSTOM", stationTemplateId: "6" },
  ];
  const { importable, skipped } = classifyTemplates(templates);
  assert.deepEqual(
    importable.map(({ template, stationType }) => [template.stationTemplateId, stationType]),
    [["2", "VISUAL_ACUITY"], ["4", "REFRACTION"], ["6", "CUSTOM"]],
  );
  assert.deepEqual(
    skipped.map((template) => template.templateKey),
    ["REGISTRATION", "CLINICAL_REVIEW", "UNKNOWN_KEY"],
  );
});

test("assertImportableBatch allows multiple CUSTOM templates and one clinical type", () => {
  const { assertImportableBatch } = require("../../services/event/stationTemplateMapping");
  assert.doesNotThrow(() => assertImportableBatch([
    { template: { stationTemplateId: "a" }, stationType: "VISUAL_ACUITY" },
    { template: { stationTemplateId: "b" }, stationType: "CUSTOM" },
    { template: { stationTemplateId: "c" }, stationType: "CUSTOM" },
  ]));
  assert.throws(
    () => assertImportableBatch([
      { template: { stationTemplateId: "a" }, stationType: "VISUAL_ACUITY" },
      { template: { stationTemplateId: "b" }, stationType: "VISUAL_ACUITY" },
    ]),
    (error) => error.code === "DUPLICATE_STATION_TYPE",
  );
  assert.throws(
    () => assertImportableBatch([
      { template: { stationTemplateId: "same" }, stationType: "CUSTOM" },
      { template: { stationTemplateId: "same" }, stationType: "CUSTOM" },
    ]),
    (error) => error.code === "DUPLICATE_STATION_TYPE",
  );
});

test("findExistingStation matches CUSTOM by template id", () => {
  const { findExistingStation } = require("../../services/event/stationTemplateMapping");
  const stations = [
    { stationId: "1", stationType: "VISUAL_ACUITY", stationTemplateId: "t1" },
    { stationId: "2", stationType: "CUSTOM", stationTemplateId: "t2" },
    { stationId: "3", stationType: "CUSTOM", stationTemplateId: "t3" },
  ];
  assert.equal(findExistingStation(stations, { stationType: "VISUAL_ACUITY" }).stationId, "1");
  assert.equal(findExistingStation(stations, { stationType: "CUSTOM", stationTemplateId: "t3" }).stationId, "3");
  assert.equal(findExistingStation(stations, { stationType: "CUSTOM", stationTemplateId: "missing" }), undefined);
});
