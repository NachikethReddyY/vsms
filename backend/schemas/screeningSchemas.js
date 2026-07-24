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
  resolveQuery,
  saveVisualAcuityBody,
};
