const { z } = require("zod");

// Reusable components for cleaner and DRY code
const uuidSchema = z.string().uuid({ message: "Invalid participant ID format. Must be a valid UUID." });
const hexTokenSchema = z.string().regex(/^[a-f0-9]{64}$/, { message: "Invalid token format. Must be a 64-character hexadecimal string." });

const participantParams = z.object({
  participantId: uuidSchema,
}).strict();

const tokenBody = z.object({
  token: hexTokenSchema,
}).strict();

module.exports = { 
  participantParams, 
  tokenBody,
  // Exporting reusable primitives in case other schemas need them
  uuidSchema,
  hexTokenSchema,
};