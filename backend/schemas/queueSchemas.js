const { z } = require("zod");

const advanceQueueSchema = z.object({
  body: z.object({
    nextStationId: z.string().uuid("Invalid station ID format").optional().nullable(),
    status: z.enum(["WAITING", "IN_PROGRESS", "COMPLETED"]).optional(),
  }),
});

module.exports = {
  advanceQueueSchema,
};