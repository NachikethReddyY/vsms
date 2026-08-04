const { z } = require("zod");

const eyeReading = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("FRACTION"),
    denominator: z.number().int().positive().max(240),
  }),
  z.object({
    kind: z.literal("EXCEPTION"),
    code: z.enum(["CF", "HM", "LP", "NLP", "NOT_TESTABLE"]),
  }),
]);

const eventParams = z.object({
  eventId: z.string().uuid(),
});

const stationParams = eventParams.extend({
  stationId: z.string().uuid(),
});

const reviewParams = eventParams.extend({
  registrationId: z.string().uuid(),
}).strict();

const referralParams = eventParams.extend({ referralId: z.string().uuid() }).strict();
const referralDocumentParams = referralParams.extend({ documentId: z.string().uuid() }).strict();
const issueReferralBody = z.object({
  destinationEmail: z.string().trim().toLowerCase().email().max(255),
  signatureObjectKey: z.string().regex(/^signatures\/[a-f0-9-]{36}\/referral-[a-f0-9-]{36}-[a-f0-9-]{36}\.(png|jpg)$/),
  signatureSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  signatureMimeType: z.enum(["image/png", "image/jpeg"]),
  idempotencyKey: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();

const acknowledgeReferralHandoffBody = z.object({
  idempotencyKey: z.string().uuid(),
}).strict();

const reviseReferralBody = z.object({
  destinationName: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(10).max(2000),
  instructions: z.string().trim().max(2000).optional(),
  urgency: z.enum(["ROUTINE", "PRIORITY", "URGENT", "EMERGENCY"]),
  idempotencyKey: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();

const clinicalSummary = z.string().trim().min(10).max(2000);
const recommendations = z.string().trim().max(2000).optional();
const contextVersion = z.string().regex(/^[a-f0-9]{64}$/);
const referral = z.object({
  destinationName: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(10).max(2000),
  instructions: z.string().trim().max(2000).optional(),
}).strict();
const commonDecision = {
  contextVersion,
  confirmed: z.literal(true),
  clinicalSummary,
  recommendations,
  signatureObjectKey: z.string().regex(/^signatures\/[a-f0-9-]{36}\/review-decision-[a-f0-9-]{36}-[a-f0-9-]{36}\.(png|jpg)$/),
  signatureSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  signatureMimeType: z.enum(["image/png", "image/jpeg"]),
};
const reviewDecisionBody = z.discriminatedUnion("outcome", [
  z.object({ ...commonDecision, outcome: z.literal("COMPLETE") }).strict(),
  z.object({ ...commonDecision, outcome: z.literal("MONITOR") }).strict(),
  z.object({
    ...commonDecision,
    outcome: z.literal("REFER"),
    urgency: z.enum(["ROUTINE", "PRIORITY", "URGENT"]),
    referral,
  }).strict(),
  z.object({
    ...commonDecision,
    outcome: z.literal("URGENT_ESCALATION"),
    referral,
  }).strict(),
]);

const resolveQuery = z.object({
  passToken: z.string().min(4).max(255).optional(),
  registrationId: z.string().uuid().optional(),
}).refine((value) => Boolean(value.passToken || value.registrationId), {
  message: "passToken or registrationId is required",
});

const visualAcuityResultData = z.object({
  chartDistanceMetres: z.union([z.literal(3), z.literal(6)]),
  od: eyeReading,
  os: eyeReading,
  withUsualDistanceGlasses: z.boolean().nullable(),
});

const previewVisualAcuityBody = z.object({
  resultData: visualAcuityResultData,
});

const saveVisualAcuityBody = z.object({
  registrationId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(64),
  // Required true when server flags the result; ignored for NORMAL.
  acknowledged: z.boolean(),
  resultData: visualAcuityResultData,
});

const isQuarterDiopter = (value) => Number.isFinite(value)
  && Math.abs((value * 4) - Math.round(value * 4)) < 1e-6;

const refractionEye = z.object({
  sphere: z.number().min(-20).max(20).refine(isQuarterDiopter, "Sphere must be in 0.25 D steps"),
  cylinder: z.number().min(-10).max(10).refine(isQuarterDiopter, "Cylinder must be in 0.25 D steps"),
  axis: z.number().int().min(0).max(180).nullable(),
}).superRefine((eye, ctx) => {
  if (Math.abs(eye.cylinder) >= 0.25 && eye.axis == null) {
    ctx.addIssue({ code: "custom", message: "Axis is required when cylinder is non-zero", path: ["axis"] });
  }
});

const refractionResultData = z.discriminatedUnion("measurementStatus", [
  z.object({
    measurementStatus: z.literal("COMPLETED"),
    wearsDistanceGlasses: z.boolean().nullable(),
    od: refractionEye,
    os: refractionEye,
    notes: z.string().trim().max(500).optional(),
  }),
  z.object({
    measurementStatus: z.enum(["UNABLE_TO_MEASURE", "REPEAT_REQUIRED"]),
    wearsDistanceGlasses: z.boolean().nullable(),
    notes: z.string().trim().min(3).max(500),
  }),
]);

const previewRefractionBody = z.object({
  resultData: refractionResultData,
});

const saveRefractionBody = z.object({
  registrationId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(64),
  acknowledged: z.boolean(),
  resultData: refractionResultData,
});

const colourVisionResultData = z.object({
  testKit: z.literal("ISHIHARA"),
  platesPresented: z.number().int().min(8).max(24),
  odCorrect: z.number().int().min(0),
  osCorrect: z.number().int().min(0),
}).superRefine((data, ctx) => {
  if (data.odCorrect > data.platesPresented) {
    ctx.addIssue({ code: "custom", message: "odCorrect cannot exceed platesPresented", path: ["odCorrect"] });
  }
  if (data.osCorrect > data.platesPresented) {
    ctx.addIssue({ code: "custom", message: "osCorrect cannot exceed platesPresented", path: ["osCorrect"] });
  }
});

const previewColourVisionBody = z.object({
  resultData: colourVisionResultData,
});

const saveColourVisionBody = z.object({
  registrationId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(64),
  acknowledged: z.boolean(),
  resultData: colourVisionResultData,
});

const screeningSyncAction = z.discriminatedUnion("stationType", [
  z.object({
    clientActionId: z.string().uuid(),
    stationId: z.string().uuid(),
    stationType: z.literal("VISUAL_ACUITY"),
    payload: saveVisualAcuityBody.strict(),
  }).strict(),
  z.object({
    clientActionId: z.string().uuid(),
    stationId: z.string().uuid(),
    stationType: z.literal("REFRACTION"),
    payload: saveRefractionBody.strict(),
  }).strict(),
  z.object({
    clientActionId: z.string().uuid(),
    stationId: z.string().uuid(),
    stationType: z.literal("COLOUR_VISION"),
    payload: saveColourVisionBody.strict(),
  }).strict(),
]);

const screeningSyncBody = z.object({
  clientBatchId: z.string().uuid(),
  cursor: z.string().datetime({ offset: true }).optional(),
  actions: z.array(screeningSyncAction).max(25),
}).strict();

module.exports = {
  eventParams,
  stationParams,
  reviewParams,
  reviewDecisionBody,
  referralParams,
  referralDocumentParams,
  issueReferralBody,
  acknowledgeReferralHandoffBody,
  reviseReferralBody,
  resolveQuery,
  previewVisualAcuityBody,
  saveVisualAcuityBody,
  previewRefractionBody,
  saveRefractionBody,
  previewColourVisionBody,
  saveColourVisionBody,
  screeningSyncBody,
};
