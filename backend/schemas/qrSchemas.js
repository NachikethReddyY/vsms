const { z } = require("zod");
const { extractQrToken } = require("../utils/crypto/qrToken");

// Reusable components for cleaner and DRY code
const uuidSchema = z.string().uuid({ message: "Invalid participant ID format. Must be a valid UUID." });
const hexTokenSchema = z.string().regex(/^[a-f0-9]{64}$/, { message: "Invalid token format. Must be a 64-character hexadecimal string." });
const scannedTokenSchema = z.string().trim().min(64).max(2048).transform((value, context) => {
  const token = extractQrToken(value);
  if (!token) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid secure QR pass" });
    return z.NEVER;
  }
  return token;
});

const participantParams = z.object({
  participantId: uuidSchema,
}).strict();

const tokenParams = z.object({ token: hexTokenSchema }).strict();

const tokenBody = z.object({
  token: scannedTokenSchema,
  eventId: z.string().uuid().optional(),
}).strict();

module.exports = { 
  participantParams, 
  tokenParams,
  tokenBody,
  // Exporting reusable primitives in case other schemas need them
  uuidSchema,
  hexTokenSchema,
  scannedTokenSchema,
};
