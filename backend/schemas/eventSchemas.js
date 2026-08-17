const { z } = require("zod");

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const bannerKey = z.enum(["COMMUNITY_SCREENING", "LIBRARY_SCREENING", "EVENT_OPERATIONS"]);
const artworkDataUrl = z.union([
  z.string().max(180000).regex(
    /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
    "Artwork must be a JPEG or WebP data URL",
  ),
  z.string().regex(
    /^\/api\/v1\/(?:public\/)?events\/[a-f0-9-]{36}\/artwork(?:\?v=\d+)?$/i,
    "Artwork must reference a VSMS event image",
  ),
]).nullable();
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
  firstManagerUserId: uuid.optional(),
  eventDays: z.array(eventDayInput).min(1).max(31).optional(),
  stations: z.array(eventStationInput).max(50).optional(),
  shifts: z.array(shiftInput).max(50).default([]),
}).strict().superRefine((value, ctx) => {
  validateEventRange(value, ctx);
  const stationOrders = (value.stations || []).map((station) => station.stationOrder);
  if (new Set(stationOrders).size !== stationOrders.length) {
    ctx.addIssue({ code: "custom", path: ["stations"], message: "Station order must be unique" });
  }
});
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
}).strict().superRefine((value, ctx) => {
  validateEventRange(value, ctx);
  const stationOrders = (value.stations || []).map((station) => station.stationOrder);
  if (new Set(stationOrders).size !== stationOrders.length) {
    ctx.addIssue({ code: "custom", path: ["stations"], message: "Station order must be unique" });
  }
}).refine((value) => Object.keys(value).some((key) => key !== "version"), {
  message: "At least one editable field is required",
});

const transitionBody = z.object({ version: z.number().int().positive() }).strict();
const cancelBody = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
}).strict();
const deleteEventBody = z.object({
  version: z.number().int().positive(),
  // Deliberately do not trim: this must be an exact acknowledgement of the event name.
  confirmationName: z.string().min(1).max(150),
  acknowledgePermanentDeletion: z.literal(true),
  previewToken: z.string().min(32).max(4096),
}).strict();

const membershipRole = z.enum(["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"]);
const membershipParams = z.object({ eventId: uuid, membershipId: uuid }).strict();
const membershipRoleParams = z.object({ eventId: uuid, membershipId: uuid, role: membershipRole }).strict();
const membershipBody = z.object({
  userId: uuid,
  roles: z.array(membershipRole).min(1).max(5).refine((roles) => new Set(roles).size === roles.length, "Roles must be unique"),
}).strict();
const membershipRemovalBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const membershipRoleBody = z.object({ role: membershipRole }).strict();
const eligibleUsersQuery = z.object({
  search: z.string().trim().min(2).max(150).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

const eventParams = z.object({ eventId: uuid }).strict();
const offlinePackHeaders = z.object({ "x-device-id": uuid }).passthrough();
const listQuery = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["DRAFT", "PUBLISHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  search: z.string().trim().max(150).optional(),
}).strict();
const auditQuery = z.object({ cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const attendeeQuery = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["SIGNED_UP", "CHECKED_IN", "COMPLETED", "CANCELLED"]).optional(),
  search: z.string().trim().max(150).optional(),
}).strict();
const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO calendar date").refine(
  (value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()),
  "Use a valid calendar date",
);
const reportQuery = z.object({
  eventId: uuid.optional(),
  from: reportDate.optional(),
  to: reportDate.optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.from || !value.to) return;
  const from = new Date(`${value.from}T00:00:00.000Z`);
  const to = new Date(`${value.to}T00:00:00.000Z`);
  if (to < from) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "Report end date must be on or after the start date" });
    return;
  }
  if (to.getTime() - from.getTime() > 366 * 86400000) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "Report date range cannot exceed 366 days" });
  }
});

const analyticsQuery = z.object({
  from: timestamp.optional(),
  to: timestamp.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) >= new Date(value.to)) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "Analytics to must be after from" });
  }
  if (value.from && value.to && new Date(value.to) - new Date(value.from) > 366 * 86400000) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "Analytics range cannot exceed 366 days" });
  }
});
const reportExportBody = z.object({
  dataset: z.enum(["OVERVIEW", "OPERATIONS", "CLINICAL", "REFERRALS"]),
  format: z.enum(["PDF", "CSV"]),
  filters: analyticsQuery.default({}),
}).strict();
const reportJobParams = z.object({ eventId: uuid, jobId: uuid }).strict();
const reportJobListQuery = z.object({
  status: z.enum(["QUEUED", "GENERATING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

const assignmentParams = z.object({ eventId: uuid, shiftId: uuid }).strict();
const assignmentDeleteParams = z.object({ eventId: uuid, shiftId: uuid, assignmentId: uuid }).strict();
const versionQuery = z.object({ version: z.coerce.number().int().positive() }).strict();
const shiftCreateBody = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  startsAt: timestamp,
  endsAt: timestamp,
  requiredStaff: z.number().int().min(1).max(1000).default(1),
}).strict().superRefine((value, ctx) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Shift end must be after its start" });
  }
});
const assignmentBody = z.object({
  version: z.number().int().positive(),
  userId: uuid.optional(),
  userIds: z.array(uuid).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "Staff members must be unique").optional(),
  assignmentRole: z.enum(["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"]),
  eventStationId: uuid.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.userId ? 1 : 0) + (value.userIds ? 1 : 0) !== 1) {
    ctx.addIssue({ code: "custom", path: ["userIds"], message: "Choose one or more staff members" });
  }
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
  availabilities: z.array(stationAvailabilityInput).max(31).optional(),
  operationalStatus: z.enum(["AVAILABLE", "PAUSED", "OFFLINE"]).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), {
  message: "At least one station field is required",
});

const SCREENING_STATION_TYPES = [
  "VISUAL_ACUITY",
  "REFRACTION",
  "COLOUR_VISION",
  "EYE_HEALTH",
  "CUSTOM",
];
const stationTemplateParams = z.object({ stationTemplateId: uuid }).strict();
const fieldSchemaValue = z.array(z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(100),
  type: z.enum(["text", "number", "select", "boolean", "eye-pair", "va-eye", "refraction-eye"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
  eyes: z.enum(["OD", "OS", "BOTH"]).optional(),
  flagRules: z.array(z.object({
    op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "includes", "isTrue", "isFalse", "isEmpty", "notEmpty"]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    flag: z.enum(["REVIEW", "REFER", "URGENT"]),
    reason: z.string().trim().min(1).max(200),
  }).passthrough()).max(10).optional(),
}).passthrough()).min(1).max(40).optional();
const createStationTemplateBody = z.object({
  stationType: z.enum(SCREENING_STATION_TYPES),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  defaultCapacity: z.number().int().min(1).max(1000).default(3),
  active: z.boolean().default(true),
  fieldSchema: fieldSchemaValue,
}).strict();
const updateStationTemplateBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  defaultCapacity: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
  fieldSchema: fieldSchemaValue,
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one template field is required",
});

module.exports = {
  createEventBody,
  updateEventBody,
  transitionBody,
  cancelBody,
  deleteEventBody,
  eventParams,
  offlinePackHeaders,
  listQuery,
  auditQuery,
  attendeeQuery,
  reportQuery,
  analyticsQuery,
  reportExportBody,
  reportJobParams,
  reportJobListQuery,
  assignmentParams,
  assignmentDeleteParams,
  shiftCreateBody,
  versionQuery,
  assignmentBody,
  stationParams,
  stationImportBody,
  stationUpdateBody,
  stationTemplateParams,
  createStationTemplateBody,
  updateStationTemplateBody,
  membershipParams,
  membershipRoleParams,
  membershipBody,
  membershipRemovalBody,
  membershipRoleBody,
  eligibleUsersQuery,
};
