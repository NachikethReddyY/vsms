const { z } = require("zod");

const uuid = z.string().uuid();
const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO calendar date")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Use a valid calendar date");
const phone = z.string().trim().min(7).max(20).regex(/^\+?[0-9 ()-]+$/, "Use a valid phone number");
const optionalText = (maximum) => z.string().trim().max(maximum).nullable().optional();
const nric = z.string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[STFGM]\d{7}[A-Z]$/, "Use a valid NRIC or FIN"));

const participantParams = z.object({
  participantId: uuid,
}).strict();

const eventContextQuery = z.object({
  eventId: uuid,
}).strict();

const participantSearchBody = z.object({
  eventId: uuid,
  query: z.string().trim().min(3).max(100).optional(),
  nric: nric.optional(),
  dateOfBirth: isoDate.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine((value, ctx) => {
  if (!value.query && !value.nric && !value.dateOfBirth) {
    ctx.addIssue({
      code: "custom",
      path: ["query"],
      message: "Provide a name, contact number, masked ID, exact NRIC/FIN, or date of birth",
    });
  }
});

const participantUpdateBody = z.object({
  eventId: uuid,
  version: z.number().int().positive(),
  nric: nric.optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  dateOfBirth: isoDate.optional(),
  gender: z.string().trim().min(1).max(1).optional(),
  race: optionalText(50),
  nationality: optionalText(50),
  addressStreet: optionalText(255),
  addressUnit: optionalText(20),
  addressPostalCode: z.string().trim().regex(/^\d{6}$/, "Use a 6-digit postal code").nullable().optional(),
  contactNumber: phone.optional(),
  emergencyContact: phone.optional(),
  emergencyContactName: optionalText(100),
}).strict().refine((value) => Object.keys(value).some((key) => !["eventId", "version"].includes(key)), {
  message: "At least one participant field is required",
});

const registrationHistoryQuery = z.object({
  eventId: uuid,
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

module.exports = {
  participantParams,
  eventContextQuery,
  participantSearchBody,
  participantUpdateBody,
  registrationHistoryQuery,
};
