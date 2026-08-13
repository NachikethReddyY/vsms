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
const registrationParams = z.object({ registrationId: uuidSchema }).strict();
const qrPassParams = z.object({ qrId: uuidSchema }).strict();

const tokenBody = z.object({
  token: scannedTokenSchema,
  eventId: z.string().uuid().optional(),
}).strict();

const revokeBody = z.object({
  revokedReason: z.string().trim().min(3).max(255).optional(),
}).strict();

const manualCheckInBody = z.object({
  eventId: uuidSchema,
  registrationId: uuidSchema.optional(),
  identifier: scannedTokenSchema.optional(),
}).strict().superRefine(({ registrationId, identifier }, context) => {
  if (Boolean(registrationId) === Boolean(identifier)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Supply exactly one registration reference or QR token",
    });
  }
});

module.exports = { 
  participantParams, 
  tokenParams,
  tokenBody,
  registrationParams,
  qrPassParams,
  revokeBody,
  manualCheckInBody,
  // Exporting reusable primitives in case other schemas need them
  uuidSchema,
  hexTokenSchema,
  scannedTokenSchema,
};
