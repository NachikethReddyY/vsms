const { z } = require("zod");
const { ROUTE_OVERRIDE_REASON_CODES } = require("../services/screening/routeOverridePolicy");

const eventParams = z.object({
  eventId: z.string().uuid(),
}).strict();

const stationParams = eventParams.extend({
  stationId: z.string().uuid(),
}).strict();

const queueEntryParams = z.object({
  queueId: z.string().uuid(),
}).strict();
const eventQueueEntryParams = eventParams.extend({ queueId: z.string().uuid() }).strict();

const participantParams = z.object({
  registrationId: z.string().uuid(),
}).strict();
const eventParticipantParams = eventParams.extend({ registrationId: z.string().uuid() }).strict();

const joinQueueBody = z.object({
  registrationId: z.string().uuid(),
}).strict();

const queueHandoffBody = z.object({
  registrationId: z.string().uuid(),
}).strict();

const advanceQueueBody = z.object({
  toStationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(100).optional(),
}).strict();

const priorityQueueBody = z.object({
  isPriority: z.boolean(),
  notes: z.string().trim().max(255).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.isPriority === true && !value.notes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["notes"],
      message: "A reason is required when marking a queue entry as priority",
    });
  }
});

const routeOverrideReasonCode = z.enum(ROUTE_OVERRIDE_REASON_CODES);

const routeOverrideBody = z.object({
  stationIds: z.array(z.string().uuid()).min(1).max(100),
  reasonCode: routeOverrideReasonCode,
  expectedVersion: z.number().int().positive(),
}).strict().superRefine(({ stationIds }, ctx) => {
  if (new Set(stationIds).size !== stationIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stationIds"],
      message: "Station IDs must be unique",
    });
  }
});

module.exports = {
  eventParams,
  stationParams,
  queueEntryParams,
  eventQueueEntryParams,
  participantParams,
  eventParticipantParams,
  joinQueueBody,
  queueHandoffBody,
  transferQueueBody: advanceQueueBody,
  advanceQueueBody,
  priorityQueueBody,
  routeOverrideBody,
  routeOverrideReasonCode,
};
