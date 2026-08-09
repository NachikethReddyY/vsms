const { z } = require("zod");

const applicationRole = z.enum([
  "ADMINISTRATOR",
  "EVENT_MANAGER",
  "REGISTRATION_OFFICER",
  "SCREENER",
  "REVIEWER",
  "SUPPORT",
]);
const roleList = z.array(applicationRole).min(1).max(6).refine(
  (roles) => new Set(roles).size === roles.length,
  "Roles must not contain duplicates",
);

const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const createUserBody = z.object({
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  employeeNumber: z.string().trim().min(1).max(20),
  department: optionalText(100),
  designation: optionalText(100),
  roles: roleList,
  status: z.enum(["ACTIVE", "INACTIVE"]).default("INACTIVE"),
}).strict();

const updateUserBody = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  employeeNumber: z.string().trim().min(1).max(20).optional(),
  department: optionalText(100),
  designation: optionalText(100),
  roles: roleList.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one account field is required",
});

const userParams = z.object({ id: z.string().uuid() }).strict();

module.exports = { createUserBody, updateUserBody, userParams, roleList };
