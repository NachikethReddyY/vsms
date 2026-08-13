const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SYSTEM_FIELD_SCHEMAS,
  resolveCompatibleFieldSchema,
  mergeClinicalAndTemplateResult,
  validateResultAgainstSchema,
  normalizeClinicalResultData,
} = require("../../schemas/dynamicStationSchema");
const { visualAcuityResultData } = require("../../schemas/screeningSchemas");

const LEGACY_VA_SCHEMA = [
  { key: "distanceMetres", label: "Distance (m)", type: "number", required: true, min: 1, max: 10, unit: "m" },
  { key: "od", label: "Right eye (OD)", type: "text", required: true },
  { key: "os", label: "Left eye (OS)", type: "text", required: true },
  { key: "nearOd", label: "Near OD", type: "text", required: false },
  { key: "notes", label: "Notes", type: "text", required: false },
];

test("missing built-in snapshots fall back to the current clinical contract", () => {
  const schema = resolveCompatibleFieldSchema("VISUAL_ACUITY", null);
  assert.deepEqual(schema.map((field) => field.key), SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY.map((field) => field.key));
  assert.equal(schema.find((field) => field.key === "od").type, "va-eye");
});

test("older clinical templates keep extra fields while upgrading medical keys", () => {
  const schema = resolveCompatibleFieldSchema("VISUAL_ACUITY", LEGACY_VA_SCHEMA);
  assert.equal(schema.find((field) => field.key === "chartDistanceMetres").type, "select");
  assert.equal(schema.find((field) => field.key === "od").type, "va-eye");
  assert.equal(schema.find((field) => field.key === "od").label, "Right eye (OD)");
  assert.ok(schema.some((field) => field.key === "nearOd"));
  assert.ok(schema.some((field) => field.key === "notes"));
  assert.equal(schema.some((field) => field.key === "distanceMetres"), false);
});

test("clinical validation keeps extra customized fields that Zod would strip", () => {
  const schema = [
    ...SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY,
    { key: "screenerComment", label: "Screener comment", type: "text", required: true },
  ];
  const cleaned = validateResultAgainstSchema(schema, {
    chartDistanceMetres: "6",
    od: { kind: "FRACTION", denominator: 6 },
    os: { kind: "FRACTION", denominator: 6 },
    withUsualDistanceGlasses: "no",
    screenerComment: "Needs extra time",
  });
  const normalized = normalizeClinicalResultData("VISUAL_ACUITY", cleaned);
  const parsed = visualAcuityResultData.safeParse(normalized);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.screenerComment, undefined);
  const persisted = mergeClinicalAndTemplateResult(cleaned, parsed.data);
  assert.equal(persisted.screenerComment, "Needs extra time");
  assert.equal(persisted.chartDistanceMetres, 6);
  assert.equal(persisted.withUsualDistanceGlasses, false);
});
