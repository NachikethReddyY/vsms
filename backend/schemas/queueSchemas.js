const { z } = require("zod");

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
}).strict();

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
};
