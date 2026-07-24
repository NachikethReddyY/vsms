const { z } = require("zod");

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const bannerKey = z.enum(["COMMUNITY_SCREENING", "LIBRARY_SCREENING", "EVENT_OPERATIONS"]);
const artworkDataUrl = z.string().max(180000).regex(
  /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
  "Artwork must be a JPEG or WebP data URL",
).nullable();
const timezone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch (_error) {
    return false;
  }
}, "Timezone must be a valid IANA timezone");

const shiftInput = z.object({
  shiftId: uuid.optional(),
  name: z.string().trim().min(1).max(100),
  startsAt: timestamp,
  endsAt: timestamp,
  requiredStaff: z.number().int().min(1).max(1000).default(1),
}).strict().superRefine((value, ctx) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Shift end must be after its start" });
  }
});

const eventFields = {
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(5000).nullable().optional(),
  bannerKey: bannerKey.default("COMMUNITY_SCREENING"),
  artworkDataUrl: artworkDataUrl.optional(),
  venue: z.string().trim().min(1).max(255),
  timezone,
  startsAt: timestamp,
  endsAt: timestamp,
  capacity: z.number().int().min(1).max(100000),
};

const validateEventRange = (value, ctx) => {
  const eventStart = new Date(value.startsAt);
  const eventEnd = new Date(value.endsAt);
  if (eventEnd <= eventStart) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Event end must be after its start" });
  }
  for (const [index, shift] of (value.shifts || []).entries()) {
    if (new Date(shift.startsAt) < eventStart || new Date(shift.endsAt) > eventEnd) {
      ctx.addIssue({ code: "custom", path: ["shifts", index], message: "Shift must be within event dates" });
    }
  }
};

const createEventBody = z.object({ ...eventFields, shifts: z.array(shiftInput).max(50).default([]) }).strict().superRefine(validateEventRange);
const updateEventBody = z.object({
  version: z.number().int().positive(),
  name: eventFields.name.optional(),
  description: eventFields.description,
  bannerKey: bannerKey.optional(),
  artworkDataUrl: artworkDataUrl.optional(),
  venue: eventFields.venue.optional(),
  timezone: timezone.optional(),
  startsAt: timestamp.optional(),
  endsAt: timestamp.optional(),
  capacity: eventFields.capacity.optional(),
  shifts: z.array(shiftInput).max(50).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), {
  message: "At least one editable field is required",
});

const transitionBody = z.object({ version: z.number().int().positive() }).strict();
const cancelBody = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
}).strict();

const eventParams = z.object({ eventId: uuid }).strict();
const listQuery = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["DRAFT", "PUBLISHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  search: z.string().trim().max(150).optional(),
}).strict();
const auditQuery = z.object({ cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

const assignmentParams = z.object({ eventId: uuid, shiftId: uuid }).strict();
const assignmentDeleteParams = z.object({ eventId: uuid, shiftId: uuid, assignmentId: uuid }).strict();
const assignmentBody = z.object({
  userId: uuid,
  assignmentRole: z.enum(["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"]),
}).strict();

module.exports = {
  createEventBody,
  updateEventBody,
  transitionBody,
  cancelBody,
  eventParams,
  listQuery,
  auditQuery,
  assignmentParams,
  assignmentDeleteParams,
  assignmentBody,
};
