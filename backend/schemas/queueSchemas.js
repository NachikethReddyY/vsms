const { z } = require("zod");

// -----------------------------------------------------------------------------
// 1. REUSABLE PRIMITIVES & CUSTOM ERROR MAPS
// -----------------------------------------------------------------------------

// Reusable regex patterns for strict validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64_REGEX = /^[a-f0-9]{64}$/;

/**
 * Enterprise Primitive Schemas with sanitization transforms (e.g., trimming strings)
 */
const uuidSchema = z
  .string({ required_error: "Participant ID is required" })
  .trim()
  .regex(UUID_REGEX, { message: "Invalid participant ID format. Must be a valid UUID v4." });

const hexTokenSchema = z
  .string({ required_error: "Token is required" })
  .trim()
  .regex(HEX_64_REGEX, { message: "Invalid token format. Must be a 64-character hexadecimal string." });

// -----------------------------------------------------------------------------
// 2. DOMAIN-SPECIFIC SCHEMAS (Strict & Sanitized)
// -----------------------------------------------------------------------------

const participantParamsSchema = z
  .object({
    participantId: uuidSchema,
  })
  .strict(); // Strips or rejects unexpected path parameters for security

const tokenBodySchema = z
  .object({
    token: hexTokenSchema,
  })
  .strict(); // Rejects extra payload properties to protect against mass-assignment

// Composite schema example (Combining params and body for an endpoint)
const verifyParticipantRequestSchema = z.object({
  params: participantParamsSchema,
  body: tokenBodySchema,
});

// -----------------------------------------------------------------------------
// 3. EXPORTS (Including Inferred Types for TypeScript projects)
// -----------------------------------------------------------------------------
module.exports = {
  // Primitives
  uuidSchema,
  hexTokenSchema,
  
  // Endpoint Schemas
  participantParamsSchema,
  tokenBodySchema,
  verifyParticipantRequestSchema,
};