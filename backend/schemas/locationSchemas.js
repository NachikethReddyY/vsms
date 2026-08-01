const { z } = require("zod");

const locationSearchQuery = z.object({
  q: z.string().trim().min(3).max(120),
}).strict();

module.exports = { locationSearchQuery };
