const { z } = require("zod");

const FIELD_TYPES = ["text", "number", "select", "boolean", "eye-pair"];

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

const eyeValue = z.union([z.string().trim().min(1).max(200), z.number()]);

const validateResultAgainstSchema = (schema, resultData) => {
  const fields = parseFieldSchema(schema);
  if (!resultData || typeof resultData !== "object" || Array.isArray(resultData)) {
    const error = new Error("resultData must be an object");
    error.code = "INVALID_RESULT_DATA";
    error.status = 422;
    throw error;
  }
  const cleaned = {};
  for (const field of fields) {
    const raw = resultData[field.key];
    if (raw === undefined || raw === null || raw === "") {
      if (field.required) {
        const error = new Error(`${field.label} is required`);
        error.code = "INVALID_RESULT_DATA";
        error.status = 422;
        throw error;
      }
      continue;
    }
    if (field.type === "text") {
      if (typeof raw !== "string") throw Object.assign(new Error(`${field.label} must be text`), { code: "INVALID_RESULT_DATA", status: 422 });
      cleaned[field.key] = raw.trim().slice(0, 2000);
    } else if (field.type === "number") {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(num)) throw Object.assign(new Error(`${field.label} must be a number`), { code: "INVALID_RESULT_DATA", status: 422 });
      if (field.min !== undefined && num < field.min) throw Object.assign(new Error(`${field.label} is below minimum`), { code: "INVALID_RESULT_DATA", status: 422 });
      if (field.max !== undefined && num > field.max) throw Object.assign(new Error(`${field.label} is above maximum`), { code: "INVALID_RESULT_DATA", status: 422 });
      cleaned[field.key] = num;
    } else if (field.type === "boolean") {
      if (typeof raw !== "boolean") throw Object.assign(new Error(`${field.label} must be true or false`), { code: "INVALID_RESULT_DATA", status: 422 });
      cleaned[field.key] = raw;
    } else if (field.type === "select") {
      if (typeof raw !== "string" || !field.options.includes(raw)) {
        throw Object.assign(new Error(`${field.label} must be one of the allowed options`), { code: "INVALID_RESULT_DATA", status: 422 });
      }
      cleaned[field.key] = raw;
    } else if (field.type === "eye-pair") {
      const eyes = field.eyes || "BOTH";
      if (eyes === "BOTH") {
        if (!raw || typeof raw !== "object") throw Object.assign(new Error(`${field.label} requires OD and OS`), { code: "INVALID_RESULT_DATA", status: 422 });
        const od = eyeValue.safeParse(raw.od);
        const os = eyeValue.safeParse(raw.os);
        if (!od.success || !os.success) throw Object.assign(new Error(`${field.label} requires OD and OS values`), { code: "INVALID_RESULT_DATA", status: 422 });
        cleaned[field.key] = { od: od.data, os: os.data };
      } else {
        const value = eyeValue.safeParse(raw);
        if (!value.success) throw Object.assign(new Error(`${field.label} is required`), { code: "INVALID_RESULT_DATA", status: 422 });
        cleaned[field.key] = value.data;
      }
    }
  }
  return cleaned;
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
    { key: "distanceMetres", label: "Distance (m)", type: "number", required: true, min: 1, max: 10, unit: "m" },
    { key: "od", label: "Right eye (OD)", type: "text", required: true },
    { key: "os", label: "Left eye (OS)", type: "text", required: true },
    { key: "nearOd", label: "Near OD", type: "text", required: false },
    { key: "nearOs", label: "Near OS", type: "text", required: false },
    { key: "notes", label: "Notes", type: "text", required: false },
  ],
  REFRACTION: [
    { key: "odSph", label: "OD SPH", type: "number", required: true, unit: "D" },
    { key: "odCyl", label: "OD CYL", type: "number", required: true, unit: "D" },
    { key: "odAxis", label: "OD Axis", type: "number", required: true, min: 0, max: 180 },
    { key: "osSph", label: "OS SPH", type: "number", required: true, unit: "D" },
    { key: "osCyl", label: "OS CYL", type: "number", required: true, unit: "D" },
    { key: "osAxis", label: "OS Axis", type: "number", required: true, min: 0, max: 180 },
    { key: "notes", label: "Notes", type: "text", required: false },
  ],
  COLOUR_VISION: [
    { key: "odScore", label: "OD plate score", type: "number", required: true, min: 0, max: 24 },
    { key: "osScore", label: "OS plate score", type: "number", required: true, min: 0, max: 24 },
    { key: "platesPresented", label: "Plates presented", type: "number", required: true, min: 1, max: 24 },
    { key: "notes", label: "Notes", type: "text", required: false },
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

module.exports = {
  FIELD_TYPES,
  fieldDefinition,
  fieldSchema,
  parseFieldSchema,
  validateResultAgainstSchema,
  evaluateDynamicResult,
  SYSTEM_FIELD_SCHEMAS,
  CUSTOM_OD_NOTES_SCHEMA,
};
