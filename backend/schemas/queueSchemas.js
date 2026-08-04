const { z } = require("zod");

// Reusable primitives for cleaner schemas
const uuidSchema = z.string().uuid({ message: "Invalid station ID format. Must be a valid UUID." });
const queueStatusEnum = z.enum(["WAITING", "IN_PROGRESS", "COMPLETED"], {
  message: "Invalid status. Allowed values are WAITING, IN_PROGRESS, or COMPLETED.",
});

const advanceQueueSchema = z.object({
  body: z.object({
    nextStationId: uuidSchema.optional().nullable(),
    status: queueStatusEnum.optional(),
  }).strict(),
}).strict();

module.exports = {
  advanceQueueSchema,
};