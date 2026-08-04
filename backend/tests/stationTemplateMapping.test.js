const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IMPORTABLE_TEMPLATE_KEYS,
  NON_IMPORTABLE_TEMPLATE_KEYS,
  stationTypeForTemplateKey,
  isImportableTemplateKey,
  classifyTemplates,
} = require("../services/stationTemplateMapping");

test("importable keys match StationType enum", () => {
  assert.deepEqual(Object.keys(IMPORTABLE_TEMPLATE_KEYS).sort(), [
    "COLOUR_VISION",
    "REFRACTION",
    "VISUAL_ACUITY",
  ]);
  for (const [key, stationType] of Object.entries(IMPORTABLE_TEMPLATE_KEYS)) {
    assert.equal(key, stationType);
    assert.equal(stationTypeForTemplateKey(key), stationType);
    assert.equal(isImportableTemplateKey(key), true);
  }
});

test("templates without implemented capture flows stay catalog-only", () => {
  assert.deepEqual([...NON_IMPORTABLE_TEMPLATE_KEYS].sort(), ["CLINICAL_REVIEW", "EYE_HEALTH", "REGISTRATION"]);
  for (const key of NON_IMPORTABLE_TEMPLATE_KEYS) {
    assert.equal(stationTypeForTemplateKey(key), null);
    assert.equal(isImportableTemplateKey(key), false);
  }
});

test("classifyTemplates separates importable and skipped templates", () => {
  const templates = [
    { templateKey: "REGISTRATION", stationTemplateId: "1" },
    { templateKey: "VISUAL_ACUITY", stationTemplateId: "2" },
    { templateKey: "CLINICAL_REVIEW", stationTemplateId: "3" },
    { templateKey: "REFRACTION", stationTemplateId: "4" },
    { templateKey: "UNKNOWN_KEY", stationTemplateId: "5" },
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
