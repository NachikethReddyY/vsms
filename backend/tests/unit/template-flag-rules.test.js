const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateDynamicResult,
  mergeFlagEvaluations,
  parseFieldSchema,
} = require("../../schemas/dynamicStationSchema");

test("template flag rules flag custom fields by operator", () => {
  const schema = parseFieldSchema([
    {
      key: "systolic",
      label: "Systolic",
      type: "number",
      required: true,
      flagRules: [
        { op: "gte", value: 180, flag: "URGENT", reason: "Hypertensive urgency" },
        { op: "gte", value: 140, flag: "REVIEW", reason: "Elevated systolic" },
      ],
    },
    {
      key: "notes",
      label: "Notes",
      type: "text",
      required: false,
      flagRules: [
        { op: "includes", value: "pain", flag: "REFER", reason: "Pain mentioned" },
      ],
    },
  ]);

  const urgent = evaluateDynamicResult({ systolic: 190, notes: "" }, schema);
  assert.equal(urgent.overallFlag, "URGENT");
  assert.equal(urgent.isFlagged, true);
  assert.match(urgent.flagSummary, /Hypertensive urgency/);

  const review = evaluateDynamicResult({ systolic: 150, notes: "ok" }, schema);
  assert.equal(review.overallFlag, "REVIEW");

  const refer = evaluateDynamicResult({ systolic: 120, notes: "eye pain today" }, schema);
  assert.equal(refer.overallFlag, "REFER");

  const normal = evaluateDynamicResult({ systolic: 120, notes: "clear" }, schema);
  assert.equal(normal.overallFlag, "NORMAL");
  assert.equal(normal.isFlagged, false);
});

test("mergeFlagEvaluations keeps the worst clinical and template reasons", () => {
  const merged = mergeFlagEvaluations(
    {
      overallFlag: "REVIEW",
      isFlagged: true,
      flagSummary: "VA borderline",
      ruleVersion: "VSMS-VA-1.0",
      reasons: [{ flag: "REVIEW", reason: "VA borderline" }],
    },
    {
      overallFlag: "REFER",
      isFlagged: true,
      flagSummary: "Pain mentioned",
      ruleVersion: "TEMPLATE-FLAG-1.0",
      reasons: [{ flag: "REFER", reason: "Pain mentioned" }],
    },
  );
  assert.equal(merged.overallFlag, "REFER");
  assert.equal(merged.ruleVersion, "VSMS-VA-1.0+TF");
  assert.equal(merged.reasons.length, 2);
});
