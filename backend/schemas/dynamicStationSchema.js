const { z } = require("zod");

const FIELD_TYPES = ["text", "number", "select", "boolean", "eye-pair", "va-eye", "refraction-eye"];

const fieldDefinition = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().trim().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().trim().max(20).optional(),
  eyes: z.enum(["OD", "OS", "BOTH"]).optional(),
}).strict().superRefine((field, ctx) => {
  if (field.type === "select" && (!field.options || field.options.length < 1)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Select field ${field.key} requires options` });
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Field ${field.key} min cannot exceed max` });
  }
});

const fieldSchema = z.array(fieldDefinition).min(1).max(40).superRefine((fields, ctx) => {
  const keys = new Set();
  for (const field of fields) {
    if (keys.has(field.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate field key: ${field.key}` });
    }
    keys.add(field.key);
  }
});

const parseFieldSchema = (value) => {
  const parsed = fieldSchema.safeParse(value ?? []);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Invalid field schema";
    const error = new Error(message);
    error.code = "INVALID_FIELD_SCHEMA";
    error.status = 422;
    throw error;
  }
  return parsed.data;
};

/** Required medical fields clinical evaluators need. Labels may change; key/type/required may not. */
const CLINICAL_FIELD_CONTRACTS = {
  VISUAL_ACUITY: [
    { key: "chartDistanceMetres", type: "select", required: true, options: ["3", "6"] },
    { key: "od", type: "va-eye", required: true },
    { key: "os", type: "va-eye", required: true },
    { key: "withUsualDistanceGlasses", type: "select", required: true, options: ["yes", "no", "unknown"] },
  ],
  REFRACTION: [
    { key: "measurementStatus", type: "select", required: true, options: ["COMPLETED", "UNABLE_TO_MEASURE", "REPEAT_REQUIRED"] },
    { key: "wearsDistanceGlasses", type: "select", required: true, options: ["yes", "no", "unknown"] },
    { key: "od", type: "refraction-eye", required: false },
    { key: "os", type: "refraction-eye", required: false },
    { key: "notes", type: "text", required: false },
  ],
  COLOUR_VISION: [
    { key: "testKit", type: "select", required: true, options: ["ISHIHARA"] },
    { key: "platesPresented", type: "number", required: true, min: 8, max: 24 },
    { key: "odCorrect", type: "number", required: true, min: 0, max: 24 },
    { key: "osCorrect", type: "number", required: true, min: 0, max: 24 },
  ],
};

const assertClinicalFieldSchema = (stationType, schema) => {
  const contract = CLINICAL_FIELD_CONTRACTS[stationType];
  if (!contract) return schema;
  const fields = parseFieldSchema(schema);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const required of contract) {
    const field = byKey.get(required.key);
    if (!field) {
      const error = new Error(`Clinical field "${required.key}" is required for ${stationType}`);
      error.code = "INVALID_FIELD_SCHEMA";
      error.status = 422;
      throw error;
    }
    if (field.type !== required.type) {
      const error = new Error(`Clinical field "${required.key}" must remain type ${required.type}`);
      error.code = "INVALID_FIELD_SCHEMA";
      error.status = 422;
      throw error;
    }
    if (required.required && field.required !== true) {
      const error = new Error(`Clinical field "${required.key}" must remain required`);
      error.code = "INVALID_FIELD_SCHEMA";
      error.status = 422;
      throw error;
    }
    if (required.options) {
      const options = field.options || [];
      const locked = required.options;
      const same = locked.length === options.length && locked.every((option) => options.includes(option));
      if (!same) {
        const error = new Error(`Clinical field "${required.key}" options must remain ${locked.join(", ")}`);
        error.code = "INVALID_FIELD_SCHEMA";
        error.status = 422;
        throw error;
      }
    }
    if (required.min !== undefined && field.min !== required.min) {
      const error = new Error(`Clinical field "${required.key}" minimum must remain ${required.min}`);
      error.code = "INVALID_FIELD_SCHEMA";
      error.status = 422;
      throw error;
    }
    if (required.max !== undefined && field.max !== required.max) {
      const error = new Error(`Clinical field "${required.key}" maximum must remain ${required.max}`);
      error.code = "INVALID_FIELD_SCHEMA";
      error.status = 422;
      throw error;
    }
  }
  return fields;
};

const eyeValue = z.union([z.string().trim().min(1).max(200), z.number()]);

const vaEyeValue = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("FRACTION"),
    denominator: z.number().int().positive().max(240),
  }),
  z.object({
    kind: z.literal("EXCEPTION"),
    code: z.enum(["CF", "HM", "LP", "NLP", "NOT_TESTABLE"]),
  }),
]);

const refractionEyeValue = z.object({
  sphere: z.number().min(-20).max(20),
  cylinder: z.number().min(-10).max(10),
  axis: z.number().int().min(0).max(180).nullable(),
});

const invalidResult = (message) => {
  const error = new Error(message);
  error.code = "INVALID_RESULT_DATA";
  error.status = 422;
  return error;
};

const validateResultAgainstSchema = (schema, resultData) => {
  const fields = parseFieldSchema(schema);
  if (!resultData || typeof resultData !== "object" || Array.isArray(resultData)) {
    throw invalidResult("resultData must be an object");
  }
  const cleaned = {};
  for (const field of fields) {
    const raw = resultData[field.key];
    if (raw === undefined || raw === null || raw === "") {
      if (field.required) throw invalidResult(`${field.label} is required`);
      continue;
    }
    if (field.type === "text") {
      if (typeof raw !== "string") throw invalidResult(`${field.label} must be text`);
      cleaned[field.key] = raw.trim().slice(0, 2000);
    } else if (field.type === "number") {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(num)) throw invalidResult(`${field.label} must be a number`);
      if (field.min !== undefined && num < field.min) throw invalidResult(`${field.label} is below minimum`);
      if (field.max !== undefined && num > field.max) throw invalidResult(`${field.label} is above maximum`);
      cleaned[field.key] = num;
    } else if (field.type === "boolean") {
      if (typeof raw !== "boolean") throw invalidResult(`${field.label} must be true or false`);
      cleaned[field.key] = raw;
    } else if (field.type === "select") {
      if (typeof raw !== "string" || !field.options.includes(raw)) {
        throw invalidResult(`${field.label} must be one of the allowed options`);
      }
      cleaned[field.key] = raw;
    } else if (field.type === "eye-pair") {
      const eyes = field.eyes || "BOTH";
      if (eyes === "BOTH") {
        if (!raw || typeof raw !== "object") throw invalidResult(`${field.label} requires OD and OS`);
        const od = eyeValue.safeParse(raw.od);
        const os = eyeValue.safeParse(raw.os);
        if (!od.success || !os.success) throw invalidResult(`${field.label} requires OD and OS values`);
        cleaned[field.key] = { od: od.data, os: os.data };
      } else {
        const value = eyeValue.safeParse(raw);
        if (!value.success) throw invalidResult(`${field.label} is required`);
        cleaned[field.key] = value.data;
      }
    } else if (field.type === "va-eye") {
      const parsed = vaEyeValue.safeParse(raw);
      if (!parsed.success) throw invalidResult(`${field.label} must be a valid visual acuity reading`);
      cleaned[field.key] = parsed.data;
    } else if (field.type === "refraction-eye") {
      const parsed = refractionEyeValue.safeParse(raw);
      if (!parsed.success) throw invalidResult(`${field.label} must be a valid refraction reading`);
      cleaned[field.key] = parsed.data;
    }
  }
  return cleaned;
};

const triStateToNullableBoolean = (value) => {
  if (value === "yes" || value === true) return true;
  if (value === "no" || value === false) return false;
  return null;
};

/** Map schema-collected values into the shapes clinical evaluators expect. Extra template fields stay attached. */
const normalizeClinicalResultData = (stationType, resultData) => {
  if (stationType === "VISUAL_ACUITY") {
    return {
      ...resultData,
      chartDistanceMetres: Number(resultData.chartDistanceMetres),
      withUsualDistanceGlasses: triStateToNullableBoolean(resultData.withUsualDistanceGlasses),
    };
  }
  if (stationType === "REFRACTION") {
    const { measurementStatus, wearsDistanceGlasses, od, os, notes, ...extras } = resultData;
    const base = {
      ...extras,
      measurementStatus,
      wearsDistanceGlasses: triStateToNullableBoolean(wearsDistanceGlasses),
      ...(notes !== undefined ? { notes } : {}),
    };
    if (measurementStatus === "COMPLETED") {
      return { ...base, od, os };
    }
    return base;
  }
  return resultData;
};

/** Keep template-validated extras that clinical Zod schemas would otherwise strip. */
const mergeClinicalAndTemplateResult = (templateResult, clinicalResult) => {
  const merged = { ...clinicalResult };
  for (const [key, value] of Object.entries(templateResult || {})) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) merged[key] = value;
  }
  return merged;
};

const evaluateDynamicResult = () => ({
  overallFlag: "NORMAL",
  isFlagged: false,
  flagSummary: null,
  ruleVersion: "TEMPLATE-SCHEMA-1.0",
  reasons: [],
});

const SYSTEM_FIELD_SCHEMAS = {
  VISUAL_ACUITY: [
    {
      key: "chartDistanceMetres",
      label: "Chart distance (m)",
      type: "select",
      required: true,
      options: ["3", "6"],
    },
    { key: "od", label: "Right eye (OD)", type: "va-eye", required: true },
    { key: "os", label: "Left eye (OS)", type: "va-eye", required: true },
    {
      key: "withUsualDistanceGlasses",
      label: "With usual distance glasses",
      type: "select",
      required: true,
      options: ["yes", "no", "unknown"],
    },
  ],
  REFRACTION: [
    {
      key: "measurementStatus",
      label: "Measurement status",
      type: "select",
      required: true,
      options: ["COMPLETED", "UNABLE_TO_MEASURE", "REPEAT_REQUIRED"],
    },
    {
      key: "wearsDistanceGlasses",
      label: "Wears distance glasses",
      type: "select",
      required: true,
      options: ["yes", "no", "unknown"],
    },
    { key: "od", label: "Right eye (OD)", type: "refraction-eye", required: false },
    { key: "os", label: "Left eye (OS)", type: "refraction-eye", required: false },
    { key: "notes", label: "Notes", type: "text", required: false },
  ],
  COLOUR_VISION: [
    { key: "testKit", label: "Test kit", type: "select", required: true, options: ["ISHIHARA"] },
    { key: "platesPresented", label: "Plates presented", type: "number", required: true, min: 8, max: 24 },
    { key: "odCorrect", label: "OD plates correct", type: "number", required: true, min: 0, max: 24 },
    { key: "osCorrect", label: "OS plates correct", type: "number", required: true, min: 0, max: 24 },
  ],
  EYE_HEALTH: [
    { key: "cataractRisk", label: "Cataract risk", type: "select", required: true, options: ["NONE", "SUSPECTED", "PRESENT", "NOT_ASSESSED"] },
    { key: "glaucomaRisk", label: "Glaucoma risk", type: "select", required: true, options: ["NONE", "SUSPECTED", "PRESENT", "NOT_ASSESSED"] },
    { key: "symptomsNoted", label: "Symptoms noted", type: "boolean", required: true },
    { key: "symptomSummary", label: "Symptom summary", type: "text", required: false },
    { key: "observations", label: "Observations", type: "text", required: true },
  ],
};

const CUSTOM_OD_NOTES_SCHEMA = [
  { key: "odObservation", label: "Right eye observation", type: "text", required: true, eyes: "OD" },
  { key: "acuityHint", label: "Acuity hint", type: "select", required: false, options: ["CLEAR", "REDUCED", "NOT_TESTED"] },
  { key: "notes", label: "Notes", type: "text", required: false },
];

const TYPE_ALIASES = { string: "text", textarea: "text", integer: "number", bool: "boolean" };
const LEGACY_CLINICAL_KEY_ALIASES = {
  VISUAL_ACUITY: { distanceMetres: "chartDistanceMetres" },
  COLOUR_VISION: { odScore: "odCorrect", osScore: "osCorrect" },
};
const LEGACY_CLINICAL_KEYS_TO_DROP = {
  VISUAL_ACUITY: new Set(["distanceMetres"]),
  REFRACTION: new Set(["odSph", "odCyl", "odAxis", "osSph", "osCyl", "osAxis"]),
  COLOUR_VISION: new Set(["odScore", "osScore"]),
};

const coerceField = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const key = String(raw.key || raw.id || "").trim();
  const label = String(raw.label || raw.name || key).trim();
  const type = TYPE_ALIASES[raw.type] || raw.type;
  if (!key || !label || !FIELD_TYPES.includes(type)) return null;
  const field = { key, label, type, required: Boolean(raw.required) };
  if (Array.isArray(raw.options)) field.options = raw.options;
  if (Number.isFinite(raw.min)) field.min = raw.min;
  if (Number.isFinite(raw.max)) field.max = raw.max;
  if (typeof raw.unit === "string") field.unit = raw.unit;
  if (raw.eyes === "OD" || raw.eyes === "OS" || raw.eyes === "BOTH") field.eyes = raw.eyes;
  return field;
};

const coerceSchema = (value) => {
  if (!Array.isArray(value)) return [];
  const fields = [];
  const seen = new Set();
  for (const raw of value) {
    const field = coerceField(raw);
    if (!field || seen.has(field.key)) continue;
    seen.add(field.key);
    fields.push(field);
  }
  return fields;
};

const upgradeClinicalSchema = (stationType, fields) => {
  const system = SYSTEM_FIELD_SCHEMAS[stationType];
  if (!system) return fields;
  const aliases = LEGACY_CLINICAL_KEY_ALIASES[stationType] || {};
  const drop = LEGACY_CLINICAL_KEYS_TO_DROP[stationType] || new Set();
  const extras = [];
  const seenExtra = new Set();
  for (const field of fields) {
    const mappedKey = aliases[field.key] || field.key;
    if (system.some((item) => item.key === mappedKey) || drop.has(field.key)) continue;
    if (seenExtra.has(field.key)) continue;
    seenExtra.add(field.key);
    extras.push(field);
  }
  return [
    ...system.map((required) => {
      const existing = fields.find((field) => (aliases[field.key] || field.key) === required.key);
      if (!existing) return required;
      return {
        ...required,
        label: existing.label || required.label,
      };
    }),
    ...extras,
  ];
};

const keepParseableFields = (fields) => {
  const kept = [];
  for (const field of fields) {
    const next = [...kept, field];
    if (fieldSchema.safeParse(next).success) kept.push(field);
  }
  return kept;
};

/**
 * Open pre-upgrade stations/templates: missing snapshots fall back to the current
 * clinical contract, and older field JSON is coerced without dropping extra fields.
 */
const resolveCompatibleFieldSchema = (stationType, snapshot) => {
  const coerced = coerceSchema(snapshot);
  if (CLINICAL_FIELD_CONTRACTS[stationType]) {
    return parseFieldSchema(upgradeClinicalSchema(stationType, coerced));
  }
  if (!coerced.length) return null;
  const parsed = fieldSchema.safeParse(coerced);
  if (parsed.success) return parsed.data;
  const kept = keepParseableFields(coerced);
  return kept.length ? kept : null;
};

module.exports = {
  FIELD_TYPES,
  fieldDefinition,
  fieldSchema,
  parseFieldSchema,
  assertClinicalFieldSchema,
  CLINICAL_FIELD_CONTRACTS,
  validateResultAgainstSchema,
  normalizeClinicalResultData,
  mergeClinicalAndTemplateResult,
  resolveCompatibleFieldSchema,
  evaluateDynamicResult,
  SYSTEM_FIELD_SCHEMAS,
  CUSTOM_OD_NOTES_SCHEMA,
};
