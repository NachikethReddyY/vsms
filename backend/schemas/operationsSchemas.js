const { z } = require("zod");

const operationsOverviewQuery = z.object({
  status: z.enum(["ALL", "ACTIVE", "UPCOMING", "COMPLETED"]).default("ALL"),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

module.exports = { operationsOverviewQuery };
