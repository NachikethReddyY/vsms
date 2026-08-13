const { z } = require("zod");

const uuid = z.string().uuid();

const registrationParams = z.object({
  registrationId: uuid,
}).strict();

const createRegistrationBody = z.object({
  participantId: uuid,
  eventId: uuid,
}).strict();

const eventRegistrationBody = z.object({
  participantId: uuid,
}).strict();

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
