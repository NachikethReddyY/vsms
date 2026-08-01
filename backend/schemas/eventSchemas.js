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

const assignmentInput = z.object({
  staffAssignmentId: uuid.optional(),
  userId: uuid,
  assignmentRole: z.enum(["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"]),
  stationTemplateId: uuid.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.assignmentRole === "SCREENER" && !value.stationTemplateId) {
    ctx.addIssue({ code: "custom", path: ["stationTemplateId"], message: "Screeners must be assigned to an event station" });
  }
});

const shiftInput = z.object({
  shiftId: uuid.optional(),
  name: z.string().trim().min(1).max(100),
  startsAt: timestamp,
  endsAt: timestamp,
  requiredStaff: z.number().int().min(1).max(1000).default(1),
  assignments: z.array(assignmentInput).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Shift end must be after its start" });
  }
});

const eventDayInput = z.object({
  eventDayId: uuid.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO calendar date"),
  startsAt: timestamp,
  endsAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Day end must be after its start" });
  }
});

const stationAvailabilityInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO calendar date"),
  isAvailable: z.boolean(),
  startsAt: timestamp.nullable().optional(),
  endsAt: timestamp.nullable().optional(),
  capacity: z.number().int().min(1).max(100000),
}).strict().superRefine((value, ctx) => {
  if (value.isAvailable && (!value.startsAt || !value.endsAt)) {
    ctx.addIssue({ code: "custom", path: ["startsAt"], message: "Available stations require operating hours" });
  }
  if (!value.isAvailable && (value.startsAt || value.endsAt)) {
    ctx.addIssue({ code: "custom", path: ["startsAt"], message: "Unavailable stations cannot have operating hours" });
  }
  if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Station end must be after its start" });
  }
});

const eventStationInput = z.object({
  eventStationId: uuid.optional(),
  stationTemplateId: uuid,
  stationOrder: z.number().int().min(1).max(50),
  capacity: z.number().int().min(1).max(100000),
  isAvailable: z.boolean().default(true),
  availabilities: z.array(stationAvailabilityInput).max(31),
}).strict();

const eventFields = {
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(5000).nullable().optional(),
  bannerKey: bannerKey.default("COMMUNITY_SCREENING"),
  artworkDataUrl: artworkDataUrl.optional(),
  venue: z.string().trim().min(1).max(255),
  address: z.string().trim().max(500).nullable().optional(),
  postalCode: z.string().regex(/^\d{6}$/).nullable().optional(),
  latitude: z.number().min(1.13).max(1.48).nullable().optional(),
  longitude: z.number().min(103.59).max(104.10).nullable().optional(),
  locationProvider: z.enum(["ONEMAP", "MANUAL"]).nullable().optional(),
  locationReference: z.string().trim().max(255).nullable().optional(),
  timezone,
  startsAt: timestamp,
  endsAt: timestamp,
  capacity: z.number().int().min(1).max(100000),
  expectedAttendance: z.number().int().min(1).max(1000000).nullable().optional(),
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
  if ((value.latitude == null) !== (value.longitude == null)) {
    ctx.addIssue({ code: "custom", path: ["latitude"], message: "Latitude and longitude must be provided together" });
  }
  if (value.locationProvider === "ONEMAP" && value.timezone !== "Asia/Singapore") {
    ctx.addIssue({ code: "custom", path: ["timezone"], message: "OneMap locations use Asia/Singapore" });
  }
  const days = value.eventDays || [];
  if (new Set(days.map((day) => day.date)).size !== days.length) {
    ctx.addIssue({ code: "custom", path: ["eventDays"], message: "Event dates must be unique" });
  }
  if (new Set((value.stations || []).map((station) => station.stationTemplateId)).size !== (value.stations || []).length) {
    ctx.addIssue({ code: "custom", path: ["stations"], message: "Station templates must be unique" });
  }
  for (const [stationIndex, station] of (value.stations || []).entries()) {
    if (new Set(station.availabilities.map((entry) => entry.date)).size !== station.availabilities.length) {
      ctx.addIssue({ code: "custom", path: ["stations", stationIndex, "availabilities"], message: "Station dates must be unique" });
    }
    for (const availability of station.availabilities) {
      if (value.eventDays && !days.some((day) => day.date === availability.date)) {
        ctx.addIssue({ code: "custom", path: ["stations", stationIndex, "availabilities"], message: "Station availability must match an event date" });
        break;
      }
    }
  }
  for (const [shiftIndex, shift] of (value.shifts || []).entries()) {
    if (shift.assignments && new Set(shift.assignments.map((assignment) => assignment.userId)).size !== shift.assignments.length) {
      ctx.addIssue({ code: "custom", path: ["shifts", shiftIndex, "assignments"], message: "A person can only be assigned once per shift" });
    }
  }
};

const createEventBody = z.object({
  ...eventFields,
  eventDays: z.array(eventDayInput).min(1).max(31).optional(),
  stations: z.array(eventStationInput).max(50).optional(),
  shifts: z.array(shiftInput).max(50).default([]),
}).strict().superRefine(validateEventRange);
const updateEventBody = z.object({
  version: z.number().int().positive(),
  name: eventFields.name.optional(),
  description: eventFields.description,
  bannerKey: bannerKey.optional(),
  artworkDataUrl: artworkDataUrl.optional(),
  venue: eventFields.venue.optional(),
  address: eventFields.address,
  postalCode: eventFields.postalCode,
  latitude: eventFields.latitude,
  longitude: eventFields.longitude,
  locationProvider: eventFields.locationProvider,
  locationReference: eventFields.locationReference,
  timezone: timezone.optional(),
  startsAt: timestamp.optional(),
  endsAt: timestamp.optional(),
  capacity: eventFields.capacity.optional(),
  expectedAttendance: eventFields.expectedAttendance,
  eventDays: z.array(eventDayInput).min(1).max(31).optional(),
  stations: z.array(eventStationInput).max(50).optional(),
  shifts: z.array(shiftInput).max(50).optional(),
}).strict().superRefine(validateEventRange).refine((value) => Object.keys(value).some((key) => key !== "version"), {
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
const versionQuery = z.object({ version: z.coerce.number().int().positive() }).strict();
const assignmentBody = z.object({
  version: z.number().int().positive(),
  userId: uuid,
  assignmentRole: z.enum(["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"]),
  eventStationId: uuid.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.assignmentRole === "SCREENER" && !value.eventStationId) {
    ctx.addIssue({ code: "custom", path: ["eventStationId"], message: "Screeners must be assigned to an event station" });
  }
});
const stationParams = z.object({ eventId: uuid, eventStationId: uuid }).strict();
const stationImportBody = z.object({
  version: z.number().int().positive(),
  stationTemplateIds: z.array(uuid).min(1).max(50).refine((ids) => new Set(ids).size === ids.length, "Station templates must be unique"),
}).strict();
const stationUpdateBody = z.object({
  version: z.number().int().positive(),
  stationOrder: z.number().int().min(1).max(50).optional(),
  capacity: z.number().int().min(1).max(1000).optional(),
  isAvailable: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), {
  message: "At least one station field is required",
});

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
  versionQuery,
  assignmentBody,
  stationParams,
  stationImportBody,
  stationUpdateBody,
};
