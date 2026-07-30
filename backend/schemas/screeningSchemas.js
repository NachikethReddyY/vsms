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

const saveVisualAcuityBody = z.object({
  registrationId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(64),
  acknowledged: z.literal(true),
  resultData: z.object({
    chartDistanceMetres: z.union([z.literal(3), z.literal(6)]),
    od: eyeReading,
    os: eyeReading,
    withUsualDistanceGlasses: z.boolean().nullable(),
  }),
});

module.exports = {
  eventParams,
  stationParams,
  reviewParams,
  reviewDecisionBody,
  resolveQuery,
  saveVisualAcuityBody,
};
