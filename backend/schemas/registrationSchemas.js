const { z } = require("zod");

const uuid = z.string().uuid();

const registrationParams = z.object({
  registrationId: uuid,
}).strict();

const registrationEvidence = {
  workflowStartedAt: z.string().datetime({ offset: true }).optional(),
  paperFormUsed: z.boolean().optional().default(false),
  paperExceptionReason: z.string().trim().min(3).max(200).optional(),
};

const createRegistrationBody = z.object({
  participantId: uuid,
  eventId: uuid,
  ...registrationEvidence,
}).strict().superRefine((value, ctx) => {
  if (value.paperFormUsed && !value.paperExceptionReason) {
    ctx.addIssue({ code: "custom", path: ["paperExceptionReason"], message: "Paper exception reason is required" });
  }
  if (!value.paperFormUsed && value.paperExceptionReason) {
    ctx.addIssue({ code: "custom", path: ["paperExceptionReason"], message: "Paper exception reason requires paperFormUsed" });
  }
});

const eventRegistrationBody = z.object({
  participantId: uuid,
  ...registrationEvidence,
}).strict().superRefine((value, ctx) => {
  if (value.paperFormUsed && !value.paperExceptionReason) {
    ctx.addIssue({ code: "custom", path: ["paperExceptionReason"], message: "Paper exception reason is required" });
  }
  if (!value.paperFormUsed && value.paperExceptionReason) {
    ctx.addIssue({ code: "custom", path: ["paperExceptionReason"], message: "Paper exception reason requires paperFormUsed" });
  }
});

const registrationStatusBody = z.object({
  toStatus: z.enum(["SIGNED_UP", "CHECKED_IN", "COMPLETED", "CANCELLED"]),
  reason: z.string().trim().min(1).max(200).optional(),
}).strict();

const registrationListQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

module.exports = {
  registrationParams,
  createRegistrationBody,
  eventRegistrationBody,
  registrationStatusBody,
  registrationListQuery,
};
