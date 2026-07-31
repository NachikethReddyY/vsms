const { z } = require("zod");

const uuid = z.string().uuid();

const participantParams = z.object({
  eventId: uuid,
}).strict();

const participantBody = z.object({
  fullName: z.string().trim().min(1).max(150),
  email: z.string().email().optional(),
  phone: z.string().trim().max(20).optional(),
}).strict();

const participantSchema = z.object({
  ...participantBody.shape,
});

module.exports = {
  participantParams,
  participantBody,
  participantSchema,
};