const { z } = require("zod");
const { roleList } = require("./userSchemas");

const optionalNullableText = (max) => z.string().trim().max(max).nullable().optional();
const accountParams = z.object({ accountId: z.string().uuid() }).strict();

const profileUpdateBody = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  contactNumber: optionalNullableText(20),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one profile field is required",
});

const accountListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(100).optional(),
  approvalState: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  accessState: z.enum(["ENABLED", "SUSPENDED", "DISABLED"]).optional(),
  professionalCategory: z.enum(["STAFF", "DOCTOR"]).optional(),
  eventRole: z.enum(["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"]).optional(),
}).strict();

const approvalBody = z.object({ reason: optionalNullableText(500), roles: roleList }).strict();
const rejectionBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const suspensionBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const reactivationBody = z.object({ reason: optionalNullableText(500) }).strict();
const deprovisionBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const lifecycleEmailParams = z.object({ deliveryId: z.string().uuid() }).strict();
const lifecycleEmailMaintenanceBody = z.object({ action: z.enum(["REQUEUE", "RESOLVE"]), reason: z.string().trim().min(3).max(500) }).strict();

module.exports = {
  accountParams,
  profileUpdateBody,
  accountListQuery,
  approvalBody,
  rejectionBody,
  suspensionBody,
  reactivationBody,
  deprovisionBody,
  lifecycleEmailParams,
  lifecycleEmailMaintenanceBody,
};
