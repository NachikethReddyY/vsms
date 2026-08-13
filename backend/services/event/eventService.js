const prisma = require("../../prisma/prismaClient");
const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const AppError = require("../../errors/AppError");
const { encodeCursor, decodeCursor } = require("../../utils/http/cursor");
const {
  classifyTemplates,
  stationTypeForTemplate,
  assertImportableBatch,
  findExistingStation,
  CLINICAL_ONE_PER_EVENT_TYPES,
} = require("./stationTemplateMapping");
const { parseFieldSchema, assertClinicalFieldSchema, resolveCompatibleFieldSchema } = require("../../schemas/dynamicStationSchema");
const {
  enqueueEventArtifactCleanup,
  processArtifactCleanupTasks,
  collectEventArtifactTasks,
} = require("../platform/artifactCleanupService");
const { createExportReceipt } = require("../../utils/storage/eventExportReceipt");
const { createAuditLog, resolveAuditContext } = require("../../utils/logging/audit");
const env = require("../../config/env");
const { attendancePredicate, attendanceWhere } = require("./attendanceDefinition");
const { enqueueAccountLifecycle } = require("../account/accountLifecycleNotificationService");
const domainEventBus = require("../domain/domainEventBus");
const { assertRoleEligibility, eventVisibilityWhere, isAdministrator } = require("./eventAuthorizationService");

/** Station types whose library fieldSchema drives DynamicStationPage + API validation. */
const SCHEMA_DRIVEN_STATION_TYPES = new Set(["CUSTOM", "VISUAL_ACUITY", "REFRACTION", "COLOUR_VISION"]);

const EVENT_FIELDS = [
  "name", "description", "bannerKey", "artworkDataUrl", "venue", "address", "postalCode",
  "latitude", "longitude", "locationProvider", "locationReference", "timezone", "startsAt",
  "endsAt", "capacity", "expectedAttendance", "status", "version",
];
const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "CONFIRMED"];
const ACTIONS = {
  publish: { from: "DRAFT", to: "PUBLISHED", audit: "PUBLISHED" },
  start: { from: "PUBLISHED", to: "IN_PROGRESS", audit: "STARTED" },
  complete: { from: "IN_PROGRESS", to: "COMPLETED", audit: "COMPLETED" },
};

const assertPublishReady = (event) => {
  const hasStation = (event.stations || []).some((station) => station.isActive !== false);
  const hasAssignedPerson = (event.shifts || []).some((shift) => (
    shift.staffAssignments || []
  ).some((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status || assignment.assignmentStatus)));
  if (!hasStation || !hasAssignedPerson) {
    throw new AppError(422, "EVENT_NOT_READY", "Add at least one station and assign at least one person before publishing");
  }
};

const snapshot = (event) => ({
  ...Object.fromEntries(EVENT_FIELDS.map((field) => {
    const value = field === "artworkDataUrl" && event[field] ? "[custom artwork]" : event[field];
    return [field, value instanceof Date ? value.toISOString() : value];
  })),
  eventStations: (event.eventStations || event.stations || []).map((station) => ({
    eventStationId: station.eventStationId || station.stationId,
    stationTemplateId: station.stationTemplateId || station.stationId,
    templateVersion: station.templateVersion || 1,
    name: station.name || station.stationName,
    stationOrder: station.stationOrder,
    capacity: station.capacity,
    isAvailable: station.isAvailable ?? station.isActive,
  })),
  shifts: (event.shifts || []).map((shift) => ({
    shiftId: shift.shiftId,
    name: shift.name,
    startsAt: shift.startsAt instanceof Date ? shift.startsAt.toISOString() : shift.startsAt,
    endsAt: shift.endsAt instanceof Date ? shift.endsAt.toISOString() : shift.endsAt,
    requiredStaff: shift.requiredStaff,
    status: shift.status,
    staffAssignments: (shift.staffAssignments || []).map((assignment) => ({
      staffAssignmentId: assignment.staffAssignmentId || assignment.id,
      userId: assignment.user?.userId || assignment.assignedUser?.id || assignment.userId,
      assignmentRole: assignment.assignmentRole,
      eventStationId: assignment.eventStation?.eventStationId
        || assignment.station?.stationId
        || assignment.stationId
        || null,
      status: assignment.status,
      notes: assignment.notes ? "[redacted]" : null,
    })),
  })),
});

const eventInclude = {
  eventDays: {
    orderBy: { date: "asc" },
    select: {
      eventDayId: true,
      date: true,
      startsAt: true,
      endsAt: true,
    },
  },
  shifts: {
    orderBy: { startsAt: "asc" },
    include: {
      staffAssignments: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { assignedAt: "asc" },
        select: {
          id: true,
          userId: true,
          assignmentRole: true,
          status: true,
          notes: true,
          assignedUser: { select: { id: true, username: true, fullName: true, email: true } },
          station: { select: { stationId: true, stationTemplateId: true, stationName: true, stationOrder: true, stationType: true } },
        },
      },
    },
  },
  stations: {
    orderBy: { stationOrder: "asc" },
    select: {
      stationId: true,
      stationTemplateId: true,
      stationName: true,
      stationType: true,
      stationOrder: true,
      isActive: true,
    },
  },
  createdBy: { select: { id: true, username: true, fullName: true, email: true, sysRole: true, status: true } },
  cancelledBy: { select: { id: true, username: true, fullName: true, email: true, sysRole: true, status: true } },
  registrations: {
    // Venue occupancy must be derived from an actual check-in, never from a signup.
    where: attendancePredicate,
    select: { registrationId: true, registrationStatus: true, checkedIn: true, checkedInAt: true },
  },
  memberships: {
    where: { status: "ACTIVE" },
    select: { userId: true, roles: { select: { role: true } } },
  },
  _count: { select: { registrations: { where: { registrationStatus: { not: "CANCELLED" } } } } },
};

const eventListInclude = {
  shifts: {
    orderBy: { startsAt: "asc" },
    include: {
      staffAssignments: {
        orderBy: { createdAt: "asc" },
        select: {
          staffAssignmentId: true,
          assignmentRole: true,
          status: true,
          notes: true,
          user: { select: { userId: true, username: true } },
          eventStation: { select: { eventStationId: true, stationTemplateId: true, name: true, stationOrder: true } },
        },
      },
    },
  },
  createdBy: { select: { id: true, username: true, fullName: true, email: true, sysRole: true, status: true } },
  cancelledBy: { select: { id: true, username: true, fullName: true, email: true, sysRole: true, status: true } },
  registrations: {
    where: attendancePredicate,
    select: { registrationId: true },
  },
  _count: { select: { registrations: { where: { registrationStatus: { not: "CANCELLED" } } } } },
};

const publicUser = (value) => value ? {
  userId: value.id,
  username: value.username || value.fullName || value.email,
  email: value.email,
  systemRole: value.sysRole,
  status: value.status,
} : null;

const rosterOwner = (value) => value ? {
  userId: value.id,
  username: value.username || value.fullName || null,
} : null;

const assignmentUser = (value) => value ? {
  userId: value.id,
  username: value.username || value.fullName || "Staff member",
} : null;

const loadStationTemplates = async (db = prisma) => {
  if (!db.stationTemplate?.findMany) return { byId: new Map(), byType: new Map() };
  const templates = await db.stationTemplate.findMany({ orderBy: { stationTemplateId: "asc" } });
  const byId = new Map(templates.map((template) => [template.stationTemplateId, template]));
  const byType = new Map();
  for (const template of templates) {
    const stationType = stationTypeForTemplate(template);
    if (stationType && (!byType.has(stationType) || template.templateKey === stationType)) byType.set(stationType, template);
  }
  return { byId, byType };
};

const templateForStation = (station, templates) => station.stationTemplateId
  ? templates.byId.get(station.stationTemplateId)
  : templates.byType.get(station.stationType);

const mapStationDto = (station, event, templates) => {
  const template = templateForStation(station, templates);
  return {
    eventStationId: station.stationId,
    // Null links are legacy rows; templateForStation resolves their stable type fallback.
    stationTemplateId: template?.stationTemplateId || station.stationId,
    templateVersion: template?.version || 1,
    name: station.stationName,
    stationType: station.stationType,
    description: template?.description || station.stationType,
    stationOrder: station.stationOrder,
    // Capacity is not on Station (#30); expose template default until availability is wired.
    capacity: template?.defaultCapacity || event.capacity,
    isAvailable: station.isActive,
    fieldSchemaSnapshot: resolveCompatibleFieldSchema(
      station.stationType,
      station.fieldSchemaSnapshot ?? template?.fieldSchema ?? null,
    ),
    schemaVersion: station.schemaVersion ?? template?.version ?? null,
    availabilities: [],
  };
};

const toEventResponse = async (event, user, db = prisma, options = {}) => {
  const { _count = {}, registrations = [], stations = [] } = event;
  const templates = await loadStationTemplates(db);
  const managerView = user ? canManage(event, user) : false;
  const fullShifts = (event.shifts || []).map((shift) => ({
    shiftId: shift.shiftId,
    name: shift.name,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    requiredStaff: shift.requiredStaff,
    status: shift.status,
    staffAssignments: (shift.staffAssignments || []).map(({ assignedUser, station, ...assignment }) => {
      const template = station ? templateForStation(station, templates) : null;
      return {
        staffAssignmentId: assignment.id,
        assignmentRole: assignment.assignmentRole,
        status: assignment.status,
        notes: assignment.notes,
        user: assignmentUser(assignedUser),
        eventStation: station ? {
          eventStationId: station.stationId,
          stationTemplateId: template?.stationTemplateId || station.stationId,
          name: station.stationName,
          stationOrder: station.stationOrder,
        } : null,
      };
    }),
  }));
  const shifts = managerView ? fullShifts : fullShifts.flatMap((shift) => {
    if (!user || !["PLANNED", "ACTIVE"].includes(shift.status)) return [];
    const ownAssignments = shift.staffAssignments
      .filter((assignment) => (
        assignment.user?.userId === user.userId
        && ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
      ))
      // Roster summaries never expose private assignment notes. A staff
      // member's event-detail view can still carry their own instructions.
      .map((assignment) => options.redactStaffNotes
        ? (({ notes: _notes, ...safeAssignment }) => safeAssignment)(assignment)
        : assignment);
    return ownAssignments.length ? [{ ...shift, staffAssignments: ownAssignments }] : [];
  });
  const visibleStationIds = managerView ? null : new Set(shifts.flatMap((shift) => (
    shift.staffAssignments.flatMap((assignment) => assignment.eventStation?.eventStationId || [])
  )));
  const eventStations = stations
    .filter((station) => !visibleStationIds || visibleStationIds.has(station.stationId))
    .map((station) => mapStationDto(station, event, templates));
  const registrationCount = _count.registrations || 0;

  const response = {
    // This is deliberately an allowlist. Event persistence contains replay
    // fingerprints and organisation foreign keys which must never become API
    // fields merely because Prisma adds them to a result.
    eventId: event.eventId,
    id: event.eventId,
    name: event.name,
    eventName: event.name,
    description: event.description,
    bannerKey: event.bannerKey,
    artworkDataUrl: event.artworkDataUrl,
    venue: event.venue,
    location: event.venue,
    address: event.address,
    postalCode: event.postalCode,
    latitude: event.latitude,
    longitude: event.longitude,
    locationProvider: event.locationProvider,
    locationReference: event.locationReference,
    timezone: event.timezone,
    startsAt: event.startsAt,
    eventDate: event.startsAt,
    startTime: event.startsAt,
    endsAt: event.endsAt,
    endTime: event.endsAt,
    capacity: event.capacity,
    expectedAttendance: event.expectedAttendance,
    status: event.status,
    version: event.version,
    cancellationReason: event.cancellationReason,
    cancelledAt: event.cancelledAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    eventDays: (event.eventDays || []).map((day) => ({
      eventDayId: day.eventDayId,
      date: day.date instanceof Date ? day.date.toISOString().slice(0, 10) : String(day.date).slice(0, 10),
      startsAt: day.startsAt,
      endsAt: day.endsAt,
    })),
    shifts,
    eventStations,
    signupCount: registrationCount,
    // Detail queries include the status; list queries deliberately select only
    // already-checked-in registration ids. Treat the latter as that trusted
    // projection rather than accidentally reporting zero occupancy.
    activeCapacityCount: registrations.length,
    _count: { eventRegistrations: registrationCount },
    canManage: managerView,
  };
  if (managerView) {
    response.createdBy = publicUser(event.createdBy);
    response.cancelledBy = publicUser(event.cancelledBy);
  } else if (options.includeRosterOwner) {
    response.createdBy = rosterOwner(event.createdBy);
  }
  return response;
};

const visibilityWhere = (user) => {
  return eventVisibilityWhere(user);
};

const loadEventWithAssignment = (eventId, user, db = prisma) =>
  db.event.findFirst({
    where: { eventId, ...visibilityWhere(user) },
    include: eventInclude,
  });

const canManage = (event, user) => isAdministrator(user)
  || (event.memberships || []).some((membership) => (
    membership.userId === user.userId
    && membership.roles.some(({ role }) => role === "EVENT_MANAGER")
  ));

const requireEvent = async (eventId, user, manage = false, db = prisma) => {
  const event = await loadEventWithAssignment(eventId, user, db);
  if (!event || (manage && !canManage(event, user))) {
    throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
  }
  return event;
};

const normalizeEventData = (body) => ({
  ...(body.name !== undefined ? { name: body.name } : {}),
  ...(body.description !== undefined ? { description: body.description || null } : {}),
  ...(body.bannerKey !== undefined ? { bannerKey: body.bannerKey } : {}),
  ...(body.artworkDataUrl !== undefined ? { artworkDataUrl: body.artworkDataUrl } : {}),
  ...(body.venue !== undefined ? { venue: body.venue } : {}),
  ...(body.address !== undefined ? { address: body.address || null } : {}),
  ...(body.postalCode !== undefined ? { postalCode: body.postalCode || null } : {}),
  ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
  ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
  ...(body.locationProvider !== undefined ? { locationProvider: body.locationProvider } : {}),
  ...(body.locationReference !== undefined ? { locationReference: body.locationReference || null } : {}),
  ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
  ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
  ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
  ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
  ...(body.expectedAttendance !== undefined ? { expectedAttendance: body.expectedAttendance } : {}),
});

const normalizeShift = (shift, eventId) => ({
  eventId,
  name: shift.name,
  startsAt: new Date(shift.startsAt),
  endsAt: new Date(shift.endsAt),
  requiredStaff: shift.requiredStaff,
});

const normalizeEventDay = (day, eventId) => ({
  eventId,
  date: new Date(`${day.date}T00:00:00.000Z`),
  startsAt: new Date(day.startsAt),
  endsAt: new Date(day.endsAt),
});

const assertRange = (data, shifts, eventDays = []) => {
  if (data.endsAt <= data.startsAt) throw new AppError(422, "INVALID_EVENT_RANGE", "Event end must be after its start");
  for (const shift of shifts) {
    if (new Date(shift.startsAt) < data.startsAt || new Date(shift.endsAt) > data.endsAt) {
      throw new AppError(422, "INVALID_SHIFT_RANGE", "Every shift must be within the event schedule");
    }
  }
  for (const day of eventDays || []) {
    const startsAt = new Date(day.startsAt);
    const endsAt = new Date(day.endsAt);
    if (startsAt < data.startsAt || endsAt > data.endsAt || endsAt <= startsAt) {
      throw new AppError(422, "INVALID_EVENT_DAY_RANGE", "Every event day must be within the event schedule");
    }
  }
};

const requestIdFor = (context) => typeof context === "string" ? context : context?.requestId;
const auditFields = (tx, user, context) => resolveAuditContext({ client: tx, userId: user.userId, context });

const bumpEventVersion = async (tx, eventId, version) => {
  const changed = await tx.event.updateMany({
    where: { eventId, version },
    data: { version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
};

const scheduleConflictError = () => new AppError(
  409,
  "STAFF_SCHEDULE_CONFLICT",
  "This staff member is already assigned during that time",
);

const schedulesOverlap = (left, right) => left.startsAt < right.endsAt && left.endsAt > right.startsAt;

const lockStaffSchedules = async (tx, userIds) => {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (unique.length === 0) return;
  await tx.$executeRawUnsafe(
    `SELECT * FROM "users" WHERE "user_id" = ANY($1::uuid[]) FOR UPDATE`,
    unique,
  );
};

const assertShiftSchedulesAvailable = async (tx, eventId, desiredShifts, currentShifts) => {
  const desiredById = new Map(desiredShifts.filter((shift) => shift.shiftId).map((shift) => [shift.shiftId, shift]));
  const schedules = currentShifts.flatMap((shift) => {
    const desired = desiredById.get(shift.shiftId);
    if (!desired) return [];
    return shift.staffAssignments
      .filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status))
      .map((assignment) => ({
        userId: assignment.assignedUser?.id || assignment.user?.userId || assignment.userId,
        startsAt: new Date(desired.startsAt),
        endsAt: new Date(desired.endsAt),
      }));
  });
  if (schedules.length === 0) return;

  await lockStaffSchedules(tx, schedules.map(({ userId }) => userId));
  const byUser = new Map();
  for (const schedule of schedules) {
    byUser.set(schedule.userId, [...(byUser.get(schedule.userId) || []), schedule]);
  }
  for (const userSchedules of byUser.values()) {
    if (userSchedules.some((schedule, index) => userSchedules.slice(index + 1).some((other) => schedulesOverlap(schedule, other)))) {
      throw scheduleConflictError();
    }
  }

  const conflict = await tx.staffAssignment.findFirst({
    where: {
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      OR: schedules.map(({ userId, startsAt, endsAt }) => ({
        userId,
        shift: {
          eventId: { not: eventId },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      })),
    },
    select: { id: true },
  });
  if (conflict) throw scheduleConflictError();
};

const auditUpdate = (tx, current, updated, user, correlationId) => tx.eventAuditLog.create({
  data: {
    eventId: current.eventId,
    actorUserId: user.userId,
    action: "UPDATED",
    beforeSnapshot: snapshot(current),
    afterSnapshot: snapshot(updated),
    correlationId: requestIdFor(correlationId),
  },
});

const assertStationPlanningState = (event) => {
  if (!["DRAFT", "PUBLISHED"].includes(event.status)) {
    throw new AppError(409, "STATIONS_NOT_EDITABLE", "Stations cannot be changed after an event goes live");
  }
};

const requireTemplates = async (tx, stations) => {
  const ids = [...new Set((stations || []).map((station) => station.stationTemplateId))];
  if (ids.length === 0) return new Map();
  const templates = await tx.stationTemplate.findMany({ where: { stationTemplateId: { in: ids }, active: true } });
  if (templates.length !== ids.length) {
    throw new AppError(422, "STATION_TEMPLATE_NOT_AVAILABLE", "One or more station templates are unavailable");
  }
  const importable = [];
  for (const template of templates) {
    const stationType = stationTypeForTemplate(template);
    if (!stationType) {
      throw new AppError(
        422,
        "STATION_TEMPLATE_NOT_IMPORTABLE",
        `${template.name} cannot be imported as a screening station`,
      );
    }
    importable.push({ template, stationType });
  }
  try {
    assertImportableBatch(importable);
  } catch (error) {
    throw new AppError(error.status || 422, error.code || "DUPLICATE_STATION_TYPE", error.message);
  }
  return new Map(templates.map((template) => [template.stationTemplateId, template]));
};

const assertAssignmentSchedulesAvailable = async (tx, eventId, shifts) => {
  const schedules = shifts.flatMap((shift) => (shift.assignments || []).map((assignment) => ({
    userId: assignment.userId,
    assignmentRole: assignment.assignmentRole,
    startsAt: new Date(shift.startsAt),
    endsAt: new Date(shift.endsAt),
  })));
  if (schedules.length === 0) return;
  await lockStaffSchedules(tx, schedules.map(({ userId }) => userId));

  const activeUsers = await tx.user.findMany({
    where: {
      id: { in: [...new Set(schedules.map(({ userId }) => userId))] },
      status: "ACTIVE",
      approvalState: "APPROVED",
      accessState: "ENABLED",
      deprovisionedAt: null,
    },
    select: {
      id: true,
      professionalCategory: true,
      userRoles: { select: { role: { select: { roleName: true } } } },
      eventMemberships: {
        where: { eventId, status: "ACTIVE" },
        select: { roles: { select: { role: true } } },
      },
    },
  });
  if (activeUsers.length !== new Set(schedules.map(({ userId }) => userId)).size) {
    throw new AppError(422, "STAFF_NOT_AVAILABLE", "One or more selected staff members are unavailable");
  }
  const rolesByUser = new Map(activeUsers.map((member) => [
    member.id,
    new Set(member.eventMemberships.flatMap((membership) => membership.roles.map(({ role }) => role))),
  ]));
  if (schedules.some(({ userId, assignmentRole }) => {
    const roles = rolesByUser.get(userId);
    return !roles?.has(assignmentRole);
  })) {
    throw new AppError(422, "STAFF_ROLE_MISMATCH", "A selected staff member does not hold the required account role");
  }
  for (const schedule of schedules) {
    assertRoleEligibility(activeUsers.find(({ id }) => id === schedule.userId), [schedule.assignmentRole]);
  }
  const byUser = new Map();
  for (const schedule of schedules) byUser.set(schedule.userId, [...(byUser.get(schedule.userId) || []), schedule]);
  for (const userSchedules of byUser.values()) {
    if (userSchedules.some((schedule, index) => userSchedules.slice(index + 1).some((other) => schedulesOverlap(schedule, other)))) {
      throw scheduleConflictError();
    }
  }
  const conflict = await tx.staffAssignment.findFirst({
    where: {
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      OR: schedules.map(({ userId, startsAt, endsAt }) => ({
        userId,
        shift: {
          eventId: { not: eventId },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      })),
    },
    select: { id: true },
  });
  if (conflict) throw scheduleConflictError();
};

const createEventDays = async (tx, eventId, days) => {
  const created = [];
  for (const day of days || []) created.push(await tx.eventDay.create({ data: normalizeEventDay(day, eventId) }));
  return new Map(created.map((day) => [day.date.toISOString().slice(0, 10), day]));
};

/** Freeze catalog fieldSchema onto event stations when present (CUSTOM and clinical). */
const stationSchemaFields = (template) => {
  const fieldSchema = resolveCompatibleFieldSchema(template.stationType, template.fieldSchema);
  return {
    fieldSchemaSnapshot: fieldSchema,
    schemaVersion: template.version || 1,
  };
};

const createEventStations = async (tx, eventId, stations, daysByDate, templatesById) => {
  const stationsByTemplate = new Map();
  const existing = await tx.station.findMany({ where: { eventId }, orderBy: { stationOrder: "asc" } });
  let nextOrder = existing.reduce((max, station) => Math.max(max, station.stationOrder), 0);

  for (const input of stations || []) {
    const template = templatesById.get(input.stationTemplateId);
    const stationType = stationTypeForTemplate(template);
    if (!stationType) {
      throw new AppError(
        422,
        "STATION_TEMPLATE_NOT_IMPORTABLE",
        `${template.name} cannot be imported as a screening station`,
      );
    }

    const schemaFields = stationSchemaFields(template);
    let station = findExistingStation(existing, {
      stationType,
      stationTemplateId: template.stationTemplateId,
    });
    if (station) {
      station = await tx.station.update({
        where: { stationId: station.stationId },
        data: {
          stationName: template.name,
          stationTemplateId: template.stationTemplateId,
          stationOrder: input.stationOrder,
          isActive: input.isAvailable !== false,
          ...schemaFields,
        },
      });
    } else {
      if (CLINICAL_ONE_PER_EVENT_TYPES.includes(stationType)
        && existing.some((row) => row.stationType === stationType)) {
        throw new AppError(422, "DUPLICATE_STATION_TYPE", "Choose only one template for each screening station type");
      }
      nextOrder = Math.max(nextOrder + 1, input.stationOrder || nextOrder + 1);
      const orderTaken = existing.some((row) => row.stationOrder === input.stationOrder)
        || [...stationsByTemplate.values()].some((row) => row.stationOrder === input.stationOrder);
      const stationOrder = orderTaken ? nextOrder : (input.stationOrder || nextOrder);
      nextOrder = Math.max(nextOrder, stationOrder);
      station = await tx.station.create({
        data: {
          eventId,
          stationTemplateId: template.stationTemplateId,
          stationType,
          stationName: template.name,
          stationOrder,
          isActive: input.isAvailable !== false,
          ...schemaFields,
        },
      });
      existing.push(station);
    }
    stationsByTemplate.set(input.stationTemplateId, station);

    if (input.availabilities?.length) {
      await tx.eventStationAvailability.deleteMany({ where: { eventStationId: station.stationId } });
      for (const availability of input.availabilities) {
        const day = daysByDate.get(availability.date);
        if (!day) throw new AppError(422, "INVALID_STATION_DAY", "Station availability must match an event date");
        await tx.eventStationAvailability.create({
          data: {
            eventStationId: station.stationId,
            eventDayId: day.eventDayId,
            isAvailable: availability.isAvailable,
            startsAt: availability.isAvailable ? new Date(availability.startsAt) : null,
            endsAt: availability.isAvailable ? new Date(availability.endsAt) : null,
            capacity: availability.capacity,
          },
        });
      }
    }
  }
  return stationsByTemplate;
};

const createShiftAssignments = async (tx, eventId, shiftInputs, stationsByTemplate, assignedByUserId) => {
  await assertAssignmentSchedulesAvailable(tx, eventId, shiftInputs);
  const savedShifts = await tx.shift.findMany({ where: { eventId } });
  for (const input of shiftInputs || []) {
    if (input.assignments === undefined) continue;
    const saved = input.shiftId
      ? savedShifts.find((shift) => shift.shiftId === input.shiftId)
      : savedShifts.find((shift) => shift.name === input.name && shift.startsAt.getTime() === new Date(input.startsAt).getTime());
    if (!saved) throw new AppError(422, "INVALID_SHIFT", "A shift could not be matched to the event");
    const existingAssignments = await tx.staffAssignment.findMany({ where: { shiftId: saved.shiftId } });
    for (const assignment of input.assignments) {
      if (assignment.staffAssignmentId && !existingAssignments.some((current) => (
        current.id === assignment.staffAssignmentId && current.userId === assignment.userId
      ))) {
        throw new AppError(422, "INVALID_ASSIGNMENT", "A staff assignment does not belong to this shift");
      }
    }
    await tx.staffAssignment.deleteMany({ where: { shiftId: saved.shiftId } });
    for (const assignment of input.assignments) {
      const station = assignment.stationTemplateId ? stationsByTemplate.get(assignment.stationTemplateId) : null;
      if (assignment.stationTemplateId && !station) {
        throw new AppError(422, "STATION_NOT_AVAILABLE", "The selected event station is unavailable");
      }
      await tx.staffAssignment.create({
        data: {
          eventId,
          shiftId: saved.shiftId,
          userId: assignment.userId,
          stationId: station?.stationId || null,
          assignmentRole: assignment.assignmentRole,
          notes: assignment.notes || null,
          status: "ASSIGNED",
          assignedBy: assignedByUserId,
        },
      });
    }
  }
};

const createEvent = async (body, user, correlationId, rawIdempotencyKey, db = prisma) => {
  if (user.systemRole !== "ADMIN" || !user.roles?.includes("ADMINISTRATOR")) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to create events");
  }
  const idempotencyKey = rawIdempotencyKey && /^[A-Za-z0-9_-]{8,100}$/.test(rawIdempotencyKey) ? rawIdempotencyKey : null;
  if (rawIdempotencyKey && !idempotencyKey) {
    throw new AppError(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain 8 to 100 letters, numbers, underscores, or hyphens");
  }
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return db.$transaction(async (tx) => {
    if (idempotencyKey) {
      const replay = await tx.event.findUnique({
        where: { createdByUserId_createIdempotencyKey: { createdByUserId: user.userId, createIdempotencyKey: idempotencyKey } },
        include: eventInclude,
      });
      if (replay) {
        if (replay.createPayloadHash !== payloadHash) {
          throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different event");
        }
        return toEventResponse(replay, user);
      }
    }
    const eventData = normalizeEventData(body);
    assertRange(eventData, body.shifts, body.eventDays);
    const templatesById = await requireTemplates(tx, body.stations);
    const created = await tx.event.create({
      data: {
        ...eventData,
        createdByUserId: user.userId,
        createIdempotencyKey: idempotencyKey,
        createPayloadHash: idempotencyKey ? payloadHash : null,
        shifts: { create: (body.shifts || []).map((shift) => ({ ...normalizeShift(shift), eventId: undefined })) },
      },
    });

    const firstManagerUserId = body.firstManagerUserId || user.userId;
    const managerIds = [...new Set([user.userId, firstManagerUserId])];
    const eligibleManagers = await tx.user.count({
      where: {
        id: { in: managerIds },
        status: "ACTIVE",
        approvalState: "APPROVED",
        accessState: "ENABLED",
        deprovisionedAt: null,
      },
    });
    if (eligibleManagers !== managerIds.length) {
      throw new AppError(422, "FIRST_MANAGER_NOT_ELIGIBLE", "The first event manager must have an approved and enabled account");
    }
    for (const userId of managerIds) {
      const membership = await tx.eventMembership.create({
        data: {
          eventId: created.eventId,
          userId,
          addedById: user.userId,
          roles: { create: { role: "EVENT_MANAGER", assignedById: user.userId } },
        },
      });
      await enqueueAccountLifecycle({
        type: "EVENT_ASSIGNMENT",
        account: { id: userId },
        metadata: { eventId: created.eventId, eventName: created.name, roles: ["EVENT_MANAGER"] },
        idempotencyKey: `EVENT_ASSIGNMENT:${membership.id}:INITIAL`,
        db: tx,
      });
    }

    // Initial wizard duties are dual-written because no membership endpoint can
    // be called before the event exists. Subsequent duties require an existing role.
    for (const assignment of (body.shifts || []).flatMap((shift) => shift.assignments || [])) {
      const membership = await tx.eventMembership.upsert({
        where: { eventId_userId: { eventId: created.eventId, userId: assignment.userId } },
        update: { status: "ACTIVE", removedById: null, removedAt: null, removalReason: null },
        create: { eventId: created.eventId, userId: assignment.userId, addedById: user.userId },
      });
      await tx.eventMembershipRole.upsert({
        where: { membershipId_role: { membershipId: membership.id, role: assignment.assignmentRole } },
        update: {},
        create: { membershipId: membership.id, role: assignment.assignmentRole, assignedById: user.userId },
      });
      await enqueueAccountLifecycle({
        type: "EVENT_ASSIGNMENT",
        account: { id: assignment.userId },
        metadata: { eventId: created.eventId, eventName: created.name, roles: [assignment.assignmentRole] },
        idempotencyKey: `EVENT_ASSIGNMENT:${membership.id}:ROLE:${assignment.assignmentRole}`,
        db: tx,
      });
    }

    const daysByDate = await createEventDays(tx, created.eventId, body.eventDays);
    const stationsByTemplate = await createEventStations(tx, created.eventId, body.stations, daysByDate, templatesById);
    await createShiftAssignments(tx, created.eventId, body.shifts, stationsByTemplate, user.userId);

    const full = await tx.event.findUniqueOrThrow({
      where: { eventId: created.eventId },
      include: eventInclude,
    });

    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "CREATED",
        entityName: "Event",
        entityId: created.eventId,
        newValue: snapshot(full),
        ...await auditFields(tx, user, correlationId),
      },
    });
    await tx.eventAuditLog.create({
      data: {
        eventId: created.eventId,
        actorUserId: user.userId,
        action: "CREATED",
        beforeSnapshot: null,
        afterSnapshot: snapshot(full),
        correlationId: requestIdFor(correlationId),
      },
    });
    return toEventResponse(full, user, tx);
  });
};

const listEvents = async (query, user, db = prisma) => {
  const statuses = query.statuses || (query.status ? [query.status] : null);
  const scope = `events:${statuses?.join(",") || "all"}:${query.search || ""}:${query.limit}`;
  const cursor = decodeCursor(query.cursor, scope);

  const visibilityCondition = visibilityWhere(user);
  const conditions = [];

  if (Object.keys(visibilityCondition).length > 0) {
    conditions.push(visibilityCondition);
  }
  if (statuses) {
    conditions.push({ status: { in: statuses } });
  }
  if (query.search) {
    conditions.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { venue: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }
  if (cursor) {
    conditions.push({
      OR: [
        { startsAt: { gt: new Date(cursor.startsAt) } },
        {
          startsAt: new Date(cursor.startsAt),
          eventId: { gt: cursor.eventId || cursor.id },
        },
      ],
    });
  }

  const where = conditions.length > 0 ? { AND: conditions } : {};

  const rows = await db.event.findMany({
    where,
    include: eventInclude,
    orderBy: [{ startsAt: "asc" }, { eventId: "asc" }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const events = hasMore ? rows.slice(0, query.limit) : rows;
  const last = events.at(-1);
  return {
    events: await Promise.all(events.map((event) => toEventResponse(event, user, db, {
      redactStaffNotes: true,
      includeRosterOwner: true,
    }))),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            scope,
            startsAt: last.startsAt.toISOString(),
            eventId: last.eventId,
          })
        : null,
  };
};

const listActiveEvents = (user, db = prisma) => listEvents({
  statuses: ["PUBLISHED", "IN_PROGRESS"],
  limit: 100,
}, user, db);

const getEvent = async (eventId, user, db = prisma) => toEventResponse(await requireEvent(eventId, user, false, db), user, db);

const editableEventKeys = new Set([
  "name", "description", "bannerKey", "artworkDataUrl", "venue", "address", "postalCode",
  "latitude", "longitude", "locationProvider", "locationReference", "timezone", "startsAt",
  "endsAt", "capacity", "expectedAttendance", "eventDays", "stations", "shifts",
]);
const allowedUpdateKeys = {
  DRAFT: new Set([
    "name",
    "description",
    "bannerKey",
    "artworkDataUrl",
    "venue",
    "address",
    "postalCode",
    "latitude",
    "longitude",
    "locationProvider",
    "locationReference",
    "timezone",
    "startsAt",
    "endsAt",
    "capacity",
    "expectedAttendance",
    "eventDays",
    "stations",
    "shifts",
  ]),
  PUBLISHED: new Set([
    "name",
    "description",
    "bannerKey",
    "artworkDataUrl",
    "venue",
    "address",
    "postalCode",
    "latitude",
    "longitude",
    "locationProvider",
    "locationReference",
    "timezone",
    "startsAt",
    "endsAt",
    "capacity",
    "expectedAttendance",
    "eventDays",
    "stations",
    "shifts",
  ]),
  UPCOMING: new Set([
    "name",
    "description",
    "bannerKey",
    "artworkDataUrl",
    "venue",
    "address",
    "postalCode",
    "latitude",
    "longitude",
    "locationProvider",
    "locationReference",
    "timezone",
    "startsAt",
    "endsAt",
    "capacity",
    "expectedAttendance",
    "eventDays",
    "stations",
    "shifts",
  ]),
  ONGOING: new Set([
    "description",
    "bannerKey",
    "artworkDataUrl",
    "capacity",
  ]),
  IN_PROGRESS: new Set([
    "description",
    "bannerKey",
    "artworkDataUrl",
    "capacity",
  ]),
  COMPLETED: new Set(["bannerKey", "artworkDataUrl"]),
  CANCELLED: new Set(["bannerKey", "artworkDataUrl"]),
};

const updateEvent = async (eventId, body, user, correlationId, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  const suppliedKeys = Object.keys(body).filter(
    (key) => !["version"].includes(key)
  );

  if (suppliedKeys.some((key) => !allowedUpdateKeys[current.status]?.has(key))) {
    throw new AppError(
      409,
      "EVENT_NOT_EDITABLE",
      "One or more fields cannot be changed in the current event state"
    );
  }

  if (
    ["IN_PROGRESS", "ONGOING"].includes(current.status) &&
    body.capacity !== undefined &&
    body.capacity < current.capacity
  ) {
    throw new AppError(
      409,
      "CAPACITY_CANNOT_DECREASE",
      "Capacity cannot decrease after an event starts"
    );
  }

  const combined = { ...current, ...normalizeEventData(body) };
  const desiredShifts = body.shifts || current.shifts;
  assertRange(combined, desiredShifts, body.eventDays);

return db.$transaction(async (tx) => {
  const changed = await tx.event.updateMany({
    where: { eventId, version: body.version },
    data: { ...normalizeEventData(body), version: { increment: 1 } },
  });

  if (changed.count !== 1) {
    throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
  }

  let daysByDate;
  if (body.eventDays) {
    await tx.eventStationAvailability.deleteMany({ where: { eventDay: { eventId } } });
    await tx.eventDay.deleteMany({ where: { eventId } });
    daysByDate = await createEventDays(tx, eventId, body.eventDays);
  } else {
    const days = await tx.eventDay.findMany({ where: { eventId } });
    daysByDate = new Map(days.map((day) => [day.date.toISOString().slice(0, 10), day]));
  }

  let stationsByTemplate = new Map();
  const templates = await loadStationTemplates(tx);
  const existingStations = await tx.station.findMany({ where: { eventId } });
  for (const station of existingStations) {
    const template = templateForStation(station, templates);
    if (template) stationsByTemplate.set(template.stationTemplateId, station);
  }

  if (body.stations) {
    const templatesById = await requireTemplates(tx, body.stations);
    stationsByTemplate = await createEventStations(tx, eventId, body.stations, daysByDate, templatesById);
  } else if (body.eventDays) {
    // Recreate day-level availability rows against Station ids (column still named event_station_id).
    for (const station of existingStations) {
      for (const day of daysByDate.values()) {
        await tx.eventStationAvailability.create({
          data: {
            eventStationId: station.stationId,
            eventDayId: day.eventDayId,
            isAvailable: station.isActive,
            startsAt: station.isActive ? day.startsAt : null,
            endsAt: station.isActive ? day.endsAt : null,
            capacity: templateForStation(station, templates)?.defaultCapacity || current.capacity,
          },
        });
      }
    }
  }

  if (body.shifts) {
    await assertShiftSchedulesAvailable(tx, eventId, body.shifts, current.shifts);
    const existingById = new Map(current.shifts.map((shift) => [shift.shiftId, shift]));
    const desiredIds = body.shifts.flatMap((shift) => shift.shiftId ? [shift.shiftId] : []);

    const unknown = desiredIds.find((id) => !existingById.has(id));
    if (unknown) throw new AppError(422, "INVALID_SHIFT", "A shift does not belong to this event");

    const protectedRemoval = current.shifts.find((shift) => !desiredIds.includes(shift.shiftId) && shift.status !== "PLANNED");
    if (protectedRemoval) throw new AppError(409, "SHIFT_NOT_REMOVABLE", "Active or completed shifts cannot be removed");

    await tx.shift.deleteMany({ where: { eventId, status: "PLANNED", shiftId: { notIn: desiredIds } } });

    for (const shift of body.shifts) {
      if (shift.shiftId) {
        await tx.shift.update({ where: { shiftId: shift.shiftId }, data: normalizeShift(shift, eventId) });
      } else {
        await tx.shift.create({ data: normalizeShift(shift, eventId) });
      }
    }
    await createShiftAssignments(tx, eventId, body.shifts, stationsByTemplate, user.userId);
  }

  const updated = await tx.event.findUniqueOrThrow({
    where: { eventId },
    include: eventInclude,
  });

  await tx.auditLog.create({
    data: {
      userId: user.userId,
      action: "UPDATED",
      resource: "Event",
      details: {
        oldValue: snapshot(current),
        newValue: snapshot(updated),
      },
      ...await auditFields(tx, user, correlationId),
    },
  });
  await auditUpdate(tx, current, updated, user, correlationId);

  return toEventResponse(updated, user, tx);
});
};

const transitionEvent = async (eventId, command, body, user, correlationId, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  const transition = ACTIONS[command];
  if (!transition || current.status !== transition.from) {
    throw new AppError(409, "INVALID_EVENT_TRANSITION", "Event cannot perform that transition from its current state");
  }
  if (command === "publish") assertPublishReady(current);
  return db.$transaction(async (tx) => {
    const changed = await tx.event.updateMany({
      where: { eventId, version: body.version, status: transition.from },
      data: { status: transition.to, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
    if (command === "start") {
      await tx.shift.updateMany({ where: { eventId, status: "PLANNED" }, data: { status: "ACTIVE" } });
    } else if (command === "complete") {
      await tx.shift.updateMany({ where: { eventId, status: { in: ["PLANNED", "ACTIVE"] } }, data: { status: "COMPLETED" } });
      await tx.staffAssignment.updateMany({ where: { shift: { eventId }, status: { in: ["ASSIGNED", "CONFIRMED"] } }, data: { status: "COMPLETED" } });
    }

    const updated = await tx.event.findUniqueOrThrow({
      where: { eventId },
      include: eventInclude,
    });

    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: transition.audit,
        entityName: "Event",
        entityId: eventId,
        oldValue: snapshot(current),
        newValue: snapshot(updated),
        ...await auditFields(tx, user, correlationId),
      },
    });
    await tx.eventAuditLog.create({
      data: {
        eventId,
        actorUserId: user.userId,
        action: transition.audit,
        beforeSnapshot: snapshot(current),
        afterSnapshot: snapshot(updated),
        correlationId: requestIdFor(correlationId),
      },
    });
    await domainEventBus.emit({
      client: tx,
      type: "EVENT_TRANSITIONED",
      aggregateType: "Event",
      aggregateId: eventId,
      correlationId: requestIdFor(correlationId),
      actorUserId: user.userId,
      payload: {
        fromStatus: transition.from,
        toStatus: transition.to,
        command,
        version: updated.version,
      },
    });

    return toEventResponse(updated, user, tx);
  });
};

const cancelEvent = async (eventId, body, user, correlationId, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);

  if (
    !["DRAFT", "PUBLISHED", "UPCOMING", "IN_PROGRESS", "ONGOING"].includes(current.status) ||
    (["IN_PROGRESS", "ONGOING"].includes(current.status) && !["SUPER_ADMIN", "ADMIN"].includes(user.systemRole))
  ) {
    throw new AppError(
      409,
      "INVALID_EVENT_TRANSITION",
      "Event cannot be cancelled from its current state"
    );
  }
  return db.$transaction(async (tx) => {
    const changed = await tx.event.updateMany({
      where: { eventId, version: body.version, status: current.status },
      data: {
        status: "CANCELLED",
        cancellationReason: body.reason,
        cancelledAt: new Date(),
        cancelledByUserId: user.userId,
        version: { increment: 1 },
      },
    });

    if (changed.count !== 1) {
      throw new AppError(
        409,
        "STALE_EVENT_VERSION",
        "This event was changed by someone else"
      );
    }

    await tx.shift.updateMany({
      where: { eventId, status: { in: ["PLANNED", "ACTIVE"] } },
      data: { status: "CANCELLED" },
    });

    const updated = await tx.event.findUniqueOrThrow({
      where: { eventId },
      include: eventInclude,
    });

    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "CANCELLED",
        entityName: "Event",
        entityId: eventId,
        oldValue: snapshot(current),
        newValue: snapshot(updated),
        ...await auditFields(tx, user, correlationId),
      },
    });
    await tx.eventAuditLog.create({
      data: {
        eventId,
        actorUserId: user.userId,
        action: "CANCELLED",
        beforeSnapshot: snapshot(current),
        afterSnapshot: snapshot(updated),
        correlationId: requestIdFor(correlationId),
      },
    });
    await domainEventBus.emit({
      client: tx,
      type: "EVENT_TRANSITIONED",
      aggregateType: "Event",
      aggregateId: eventId,
      correlationId: requestIdFor(correlationId),
      actorUserId: user.userId,
      payload: {
        command: "cancel",
        fromStatus: current.status,
        toStatus: updated.status,
        version: updated.version,
      },
    });

    return toEventResponse(updated, user, tx);
  });
};

const assertNoCrossEventReferences = async (tx, eventId) => {
  const [registrations, stations, reviews] = await Promise.all([
    tx.eventRegistration.findMany({ where: { eventId }, select: { registrationId: true } }),
    tx.station.findMany({ where: { eventId }, select: { stationId: true } }),
    tx.review.findMany({ where: { registration: { eventId } }, select: { reviewId: true } }),
  ]);
  const registrationIds = registrations.map(({ registrationId }) => registrationId);
  const stationIds = stations.map(({ stationId }) => stationId);
  const reviewIds = reviews.map(({ reviewId }) => reviewId);

  const checks = [];
  if (reviewIds.length) checks.push(tx.review.findFirst({
    where: { OR: [
      { reviewId: { in: reviewIds }, parentReviewId: { not: null, notIn: reviewIds } },
      { reviewId: { notIn: reviewIds }, parentReviewId: { in: reviewIds } },
    ] },
    select: { reviewId: true },
  }));
  if (registrationIds.length || stationIds.length) {
    checks.push(tx.queueEntry.findFirst({
      where: { OR: [
        // If one side has no rows, every reference from the existing side is
        // external. Do not fabricate `not: null` filters for required UUID
        // columns: Prisma rejects those and the ownership check is clearer
        // without them.
        ...(registrationIds.length ? [{
          registrationId: { in: registrationIds },
          ...(stationIds.length ? { stationId: { notIn: stationIds } } : {}),
        }] : []),
        ...(stationIds.length ? [{
          stationId: { in: stationIds },
          ...(registrationIds.length ? { registrationId: { notIn: registrationIds } } : {}),
        }] : []),
      ] },
      select: { id: true },
    }));
    checks.push(tx.queueMovement.findFirst({
      where: { OR: [
        ...(registrationIds.length ? [{
          registrationId: { in: registrationIds },
          ...(stationIds.length ? { OR: [{ fromStationId: { notIn: stationIds } }, { toStationId: { notIn: stationIds } }] } : {}),
        }] : []),
        ...(stationIds.length ? [{
          ...(registrationIds.length ? { registrationId: { notIn: registrationIds } } : {}),
          OR: [{ fromStationId: { in: stationIds } }, { toStationId: { in: stationIds } }],
        }] : []),
      ] },
      select: { id: true },
    }));
    checks.push(tx.screeningResult.findFirst({
      where: { OR: [
        ...(registrationIds.length ? [{
          registrationId: { in: registrationIds },
          ...(stationIds.length ? { stationId: { notIn: stationIds } } : {}),
        }] : []),
        ...(stationIds.length ? [{
          stationId: { in: stationIds },
          ...(registrationIds.length ? { registrationId: { notIn: registrationIds } } : {}),
        }] : []),
      ] },
      select: { resultId: true },
    }));
  }

  if ((await Promise.all(checks)).some(Boolean)) {
    throw new AppError(409, "EVENT_DELETE_INTEGRITY_CONFLICT", "This event has cross-event records and cannot be deleted safely");
  }
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
};

const impactDigest = (impact) => crypto.createHash("sha256")
  .update(JSON.stringify(canonicalJson(impact)))
  .digest("hex");

const signDeletionPreview = (claims) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.jwtAccessSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};

const verifyDeletionPreview = (token, eventId, userId, version, now = new Date()) => {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) throw new AppError(422, "INVALID_DELETION_PREVIEW_TOKEN", "Deletion preview token is invalid");
  const expected = crypto.createHmac("sha256", env.jwtAccessSecret).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, "base64url"); } catch { supplied = Buffer.alloc(0); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new AppError(422, "INVALID_DELETION_PREVIEW_TOKEN", "Deletion preview token is invalid");
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch {
    throw new AppError(422, "INVALID_DELETION_PREVIEW_TOKEN", "Deletion preview token is invalid");
  }
  if (claims.eventId !== eventId || claims.adminId !== userId || claims.version !== version) {
    throw new AppError(422, "DELETION_PREVIEW_MISMATCH", "Deletion preview does not match this event, administrator, or version");
  }
  if (!Number.isInteger(claims.expiresAt) || claims.expiresAt <= now.getTime()) {
    throw new AppError(409, "DELETION_PREVIEW_EXPIRED", "Deletion preview has expired");
  }
  return claims;
};

const collectDeletionEntityIds = async (tx, eventId) => {
  const [participants, registrations, stations, queues, screenings, reviews, referrals, documents, qrCodes, signatures] = await Promise.all([
    tx.participant.findMany({
      where: {
        onboardingEventId: eventId,
        eventRegistrations: { none: { eventId: { not: eventId } } },
        eventIntakes: { none: { eventId: { not: eventId } } },
      },
      select: { id: true },
    }),
    tx.eventRegistration.findMany({ where: { eventId }, select: { registrationId: true } }),
    tx.station.findMany({ where: { eventId }, select: { stationId: true } }),
    tx.queueEntry.findMany({ where: { registration: { eventId } }, select: { id: true } }),
    tx.screeningResult.findMany({ where: { registration: { eventId } }, select: { resultId: true } }),
    tx.review.findMany({ where: { registration: { eventId } }, select: { reviewId: true } }),
    tx.referral.findMany({ where: { review: { registration: { eventId } } }, select: { referralId: true } }),
    tx.documentArtifact.findMany({ where: { review: { registration: { eventId } } }, select: { documentId: true } }),
    tx.qRCodePass.findMany({ where: { registration: { eventId } }, select: { id: true } }),
    tx.signatureArtifact.findMany({ where: { eventId }, select: { id: true } }),
  ]);
  return {
    participants: participants.map(({ id }) => id),
    registrations: registrations.map(({ registrationId }) => registrationId),
    stations: stations.map(({ stationId }) => stationId),
    queues: queues.map(({ id }) => id),
    screenings: screenings.map(({ resultId }) => resultId),
    reviews: reviews.map(({ reviewId }) => reviewId),
    referrals: referrals.map(({ referralId }) => referralId),
    documents: documents.map(({ documentId }) => documentId),
    qrCodes: qrCodes.map(({ id }) => id),
    signatures: signatures.map(({ id }) => id),
  };
};

const deletionImpact = async (tx, event, entityIds = null) => {
  const ids = entityIds || await collectDeletionEntityIds(tx, event.eventId);
  let blocker = null;
  try { await assertNoCrossEventReferences(tx, event.eventId); } catch (error) {
    if (error.code !== "EVENT_DELETE_INTEGRITY_CONFLICT") throw error;
    blocker = { code: error.code, message: error.message };
  }
  const [emails, cleanup, artifactTasks, reportCount, activeReportJobs] = await Promise.all([
    tx.notificationDelivery.count({ where: { OR: [
      { referral: { review: { registration: { eventId: event.eventId } } } },
      { document: { review: { registration: { eventId: event.eventId } } } },
    ] } }),
    tx.artifactCleanupTask.count({ where: { eventId: event.eventId } }),
    collectEventArtifactTasks(tx, event.eventId),
    tx.reportExportJob.count({ where: { eventId: event.eventId } }),
    tx.$queryRaw ? tx.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM report_export_jobs
      WHERE event_id = ${event.eventId}::uuid
        AND (status IN ('QUEUED', 'GENERATING')
          OR (status = 'FAILED' AND attempt_count < max_attempts AND expires_at > CURRENT_TIMESTAMP))
    `) : tx.reportExportJob.count({ where: { eventId: event.eventId, status: { in: ["QUEUED", "GENERATING"] } } }),
  ]);
  const activeReportJobCount = Array.isArray(activeReportJobs) ? Number(activeReportJobs[0]?.count || 0) : Number(activeReportJobs || 0);
  const counts = {
    participants: ids.participants.length,
    registrations: ids.registrations.length,
    queues: ids.queues.length,
    screenings: ids.screenings.length,
    reviews: ids.reviews.length,
    files: artifactTasks.length,
    emails,
    cleanup,
    reports: reportCount,
  };
  const blockers = [blocker, activeReportJobCount ? {
    code: "ACTIVE_REPORT_JOBS",
    message: "Active report jobs must finish or be cancelled before deletion",
    count: activeReportJobCount,
  } : null].filter(Boolean);
  return {
    eventId: event.eventId,
    eventName: event.name,
    status: event.status,
    version: event.version,
    counts,
    blockers,
  };
};

const assertDeletionAdministrator = (user) => {
  if (user.systemRole !== "ADMIN" || !user.roles?.includes("ADMINISTRATOR")) {
    throw new AppError(403, "FORBIDDEN", "Only an administrator can permanently delete an event");
  }
};

const previewEventDeletion = async (eventId, user, db = prisma, now = new Date()) => {
  assertDeletionAdministrator(user);
  const event = await db.event.findUnique({ where: { eventId }, select: { eventId: true, name: true, status: true, version: true } });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
  if (!["DRAFT", "COMPLETED", "CANCELLED"].includes(event.status)) {
    throw new AppError(409, "EVENT_NOT_TERMINAL", "Only draft, completed, or cancelled events can be permanently deleted");
  }
  const impact = await deletionImpact(db, event);
  const digest = impactDigest(impact);
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  return {
    ...impact,
    impactDigest: digest,
    previewExpiresAt: expiresAt,
    previewToken: signDeletionPreview({ eventId, adminId: user.userId, version: event.version, impactDigest: digest, expiresAt: expiresAt.getTime() }),
  };
};

const cleanupStateFor = async (eventId, db = prisma) => {
  const tasks = await db.artifactCleanupTask.findMany({ where: { eventId }, select: { status: true } });
  if (tasks.some(({ status }) => ["ESCALATED", "FAILED"].includes(status))) return "NEEDS_ATTENTION";
  if (tasks.some(({ status }) => ["PENDING", "PROCESSING"].includes(status))) return "QUEUED";
  return "COMPLETED";
};

const getEventDeletionCleanupStatus = async (eventId, user, db = prisma) => {
  assertDeletionAdministrator(user);
  const tasks = await db.artifactCleanupTask.findMany({
    where: { eventId },
    select: { id: true, artifactType: true, status: true, attemptCount: true, lastError: true, completedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const deletedAudit = await db.eventAuditLog.findFirst({ where: { eventId, action: "DELETED" }, select: { eventAuditLogId: true } });
  if (!deletedAudit && tasks.length === 0) throw new AppError(404, "EVENT_DELETION_NOT_FOUND", "No event deletion record was found");
  return { eventId, cleanupState: await cleanupStateFor(eventId, db), tasks };
};

const deleteEvent = async (eventId, body, user, correlationId, db = prisma) => {
  assertDeletionAdministrator(user);
  const claims = verifyDeletionPreview(body.previewToken, eventId, user.userId, body.version);
  const current = await db.event.findUnique({ where: { eventId }, include: eventInclude });
  if (!current) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
  if (!["DRAFT", "COMPLETED", "CANCELLED"].includes(current.status)) {
    throw new AppError(409, "EVENT_NOT_TERMINAL", "Only draft, completed, or cancelled events can be permanently deleted");
  }
  if (body.confirmationName !== current.name) {
    throw new AppError(422, "EVENT_DELETE_CONFIRMATION_MISMATCH", "Type the event name exactly to confirm permanent deletion");
  }

  const deletion = await db.$transaction(async (tx) => {
    const transactionEvent = await tx.event.findUnique({ where: { eventId }, include: eventInclude });
    if (!transactionEvent || transactionEvent.version !== body.version || transactionEvent.status !== current.status) {
      throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
    }
    const entityIds = await collectDeletionEntityIds(tx, eventId);
    const impact = await deletionImpact(tx, transactionEvent, entityIds);
    const digest = impactDigest(impact);
    if (digest !== claims.impactDigest) {
      throw new AppError(409, "DELETION_IMPACT_CHANGED", "Deletion impact changed; review a new preview before deleting");
    }
    if (impact.blockers.length) {
      throw new AppError(409, "EVENT_DELETE_BLOCKED", "Event deletion is blocked", { blockers: impact.blockers });
    }
    // Claim the exact state before removing children so a stale administrator cannot delete a changed event.
    const claimed = await tx.event.updateMany({
      where: { eventId, version: body.version, status: current.status },
      data: { version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
    }

    await assertNoCrossEventReferences(tx, eventId);

    // Persist the exact, validated storage targets before deleting their owner
    // rows. Filesystem work deliberately happens only after this transaction.
    const cleanupTaskCount = await enqueueEventArtifactCleanup(tx, eventId);

    await tx.notificationDelivery.deleteMany({ where: { OR: [
      { referral: { review: { registration: { eventId } } } },
      { document: { review: { registration: { eventId } } } },
    ] } });
    await tx.documentArtifact.deleteMany({ where: { review: { registration: { eventId } } } });
    await tx.referral.deleteMany({ where: { review: { registration: { eventId } } } });
    await tx.review.updateMany({ where: { registration: { eventId }, parentReviewId: { not: null } }, data: { parentReviewId: null } });
    await tx.review.deleteMany({ where: { registration: { eventId } } });

    await tx.signatureArtifact.deleteMany({ where: { eventId } });
    await tx.registrationStatusHistory.deleteMany({ where: { registration: { eventId } } });
    await tx.screeningResult.deleteMany({ where: { registration: { eventId } } });
    const historicalSyncScopes = [
      ["ScreeningResult", [...entityIds.registrations, ...entityIds.screenings]],
      ["EventRegistration", entityIds.registrations],
      ["Station", entityIds.stations],
      ["QueueEntry", entityIds.queues],
      ["Review", entityIds.reviews],
      ["Referral", entityIds.referrals],
      ["DocumentArtifact", entityIds.documents],
      ["QRCodePass", entityIds.qrCodes],
      ["SignatureArtifact", entityIds.signatures],
    ].filter(([, ids]) => ids.length).map(([entityType, ids]) => ({ eventId: null, entityType, entityId: { in: ids } }));
    await tx.syncAction.deleteMany({ where: { OR: [{ eventId }, ...historicalSyncScopes] } });
    await tx.scanLog.deleteMany({ where: { OR: [{ registration: { eventId } }, { station: { eventId } }] } });
    await tx.qRCodePass.deleteMany({ where: { registration: { eventId } } });
    await tx.queueMovement.deleteMany({ where: { registration: { eventId } } });
    await tx.queueEntry.deleteMany({ where: { registration: { eventId } } });
    await tx.eventRegistration.deleteMany({ where: { eventId } });

    await tx.participantEventIntake.deleteMany({ where: { eventId } });
    if (entityIds.participants.length) {
      await tx.participantEmergencyContact.deleteMany({ where: { participantId: { in: entityIds.participants } } });
      const deletedParticipants = await tx.participant.deleteMany({
        where: {
          id: { in: entityIds.participants },
          onboardingEventId: eventId,
          eventRegistrations: { none: {} },
          eventIntakes: { none: {} },
        },
      });
      if (deletedParticipants.count !== entityIds.participants.length) {
        throw new AppError(409, "DELETION_IMPACT_CHANGED", "Deletion impact changed; review a new preview before deleting");
      }
    }
    // Profiles reused by another event are shared and must survive.
    await tx.participant.updateMany({ where: { onboardingEventId: eventId }, data: { onboardingEventId: null } });

    await tx.staffAssignment.deleteMany({ where: { eventId } });
    await tx.shift.deleteMany({ where: { eventId } });
    await tx.eventStationAvailability.deleteMany({ where: { eventDay: { eventId } } });
    await tx.eventDay.deleteMany({ where: { eventId } });
    await tx.station.deleteMany({ where: { eventId } });

    await tx.eventAuditLog.create({
      data: {
        eventId,
        actorUserId: user.userId,
        action: "DELETED",
        beforeSnapshot: snapshot(transactionEvent),
        afterSnapshot: {
          impact,
          impactDigest: digest,
          confirmation: { exactName: true, permanentDeletionAcknowledged: true, previewBound: true, version: body.version },
        },
        correlationId: requestIdFor(correlationId),
      },
    });

    const deleted = await tx.event.deleteMany({
      where: { eventId, version: body.version + 1, status: current.status },
    });
    if (deleted.count !== 1) {
      throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
    }
    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "EVENT_DELETED",
        resource: "Event",
        entityName: "Event",
        entityId: eventId,
        details: { status: current.status, version: body.version, impact, impactDigest: digest, confirmation: "EXACT_NAME_AND_SIGNED_PREVIEW" },
        ...await auditFields(tx, user, correlationId),
      },
    });
    return { result: { eventId, deleted: true }, cleanupTaskCount };
  }, { isolationLevel: "Serializable" });

  if (deletion.cleanupTaskCount > 0) {
    await processArtifactCleanupTasks({ eventId }).catch((error) => {
      // Durable tasks remain retryable; never expose a storage path in logs.
      console.error("Post-delete artifact cleanup deferred", { eventId, code: error?.code || "ARTIFACT_CLEANUP_FAILED" });
    });
  }
  return { ...deletion.result, cleanupState: await cleanupStateFor(eventId, db) };
};

const listStaffDirectory = async () => {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", userRoles: { none: { role: { roleName: "ADMINISTRATOR" } } } },
    select: { id: true, username: true, fullName: true, email: true, sysRole: true, userRoles: { select: { role: { select: { roleName: true } } } } },
    orderBy: { fullName: "asc" },
    take: 200,
  });
  return users.map((user) => ({
    userId: user.id,
    username: user.username || user.fullName || user.email,
    systemRole: user.sysRole,
    roles: user.userRoles.map(({ role }) => role.roleName),
  }));
};

// Read-only catalog for the events UI / OpenAPI StationTemplate DTO (#23).
// Import/update map templateKey â†’ StationType per #30 (catalog keys include
// REGISTRATION / CLINICAL_REVIEW which are not StationType and are rejected on import).
const listStationTemplates = async () => {
  const templates = await prisma.stationTemplate.findMany({
    where: { active: true, stationType: { not: null } },
    select: {
      stationTemplateId: true,
      templateKey: true,
      stationType: true,
      version: true,
      name: true,
      description: true,
      defaultCapacity: true,
      active: true,
      fieldSchema: true,
    },
    orderBy: { name: "asc" },
  });
  return templates
    .filter((template) => stationTypeForTemplate(template))
    .map(serializeStationTemplate);
};

const serializeStationTemplate = (template) => ({
  stationTemplateId: template.stationTemplateId,
  templateKey: template.templateKey,
  stationType: template.stationType,
  version: template.version,
  name: template.name,
  description: template.description,
  defaultCapacity: template.defaultCapacity,
  active: template.active,
  fieldSchema: template.fieldSchema ?? null,
});

/** Read-only preview fallback — never write during catalog GET. */
const withSystemFieldSchemaFallback = (template) => {
  const fieldSchema = resolveCompatibleFieldSchema(template.stationType, template.fieldSchema);
  if (!fieldSchema) return template;
  return { ...template, fieldSchema };
};

/** Admin catalog: screening templates only — registration/clinical review/eye health are not managed here. */
const HIDDEN_LIBRARY_TEMPLATE_KEYS = new Set(["REGISTRATION", "CLINICAL_REVIEW", "EYE_HEALTH"]);
const listStationTemplateLibrary = async () => {
  const templates = await prisma.stationTemplate.findMany({
    select: {
      stationTemplateId: true,
      templateKey: true,
      stationType: true,
      version: true,
      name: true,
      description: true,
      defaultCapacity: true,
      active: true,
      fieldSchema: true,
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return templates
    .filter((template) => (
      !HIDDEN_LIBRARY_TEMPLATE_KEYS.has(template.templateKey)
      && template.stationType !== "EYE_HEALTH"
    ))
    .map((template) => serializeStationTemplate(withSystemFieldSchemaFallback(template)));
};

const createStationTemplate = async (body, user, context, db = prisma) => {
  if (body.stationType === "EYE_HEALTH") {
    throw new AppError(
      422,
      "STATION_TYPE_NOT_IMPORTABLE",
      "Eye health is recorded during clinical review, not as a screening station template",
    );
  }
  const { SYSTEM_FIELD_SCHEMAS } = require("../../schemas/dynamicStationSchema");
  let fieldSchema;
  try {
    if (!SCHEMA_DRIVEN_STATION_TYPES.has(body.stationType)) {
      throw new AppError(
        422,
        "FIELD_SCHEMA_NOT_EDITABLE",
        "Field schemas can only be defined for custom and clinical screening stations",
      );
    }
    if (body.stationType === "CUSTOM" || body.fieldSchema !== undefined) {
      fieldSchema = SCHEMA_DRIVEN_STATION_TYPES.has(body.stationType) && body.stationType !== "CUSTOM"
        ? assertClinicalFieldSchema(body.stationType, body.fieldSchema)
        : parseFieldSchema(body.fieldSchema);
    } else {
      fieldSchema = SYSTEM_FIELD_SCHEMAS[body.stationType] ?? null;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "INVALID_FIELD_SCHEMA", error.message);
  }
  try {
    return await db.$transaction(async (tx) => {
      const template = await tx.stationTemplate.create({
        data: {
          templateKey: crypto.randomUUID(),
          stationType: body.stationType,
          name: body.name,
          description: body.description ?? null,
          defaultCapacity: body.defaultCapacity,
          active: body.active,
          ...(fieldSchema !== undefined ? { fieldSchema } : {}),
        },
      });
      const serialized = serializeStationTemplate(template);
      await createAuditLog({
        userId: user.userId,
        action: "STATION_TEMPLATE_CREATED",
        entityName: "StationTemplate",
        entityId: template.stationTemplateId,
        newValue: serialized,
        context,
        client: tx,
      });
      return serialized;
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError(409, "STATION_TEMPLATE_KEY_EXISTS", "Could not allocate a unique station template key");
    }
    throw error;
  }
};

const updateStationTemplate = async (stationTemplateId, body, user, context, db = prisma) => db.$transaction(async (tx) => {
  const existing = await tx.stationTemplate.findUnique({ where: { stationTemplateId } });
  if (!existing) throw new AppError(404, "STATION_TEMPLATE_NOT_FOUND", "Station template not found");
  if (
    HIDDEN_LIBRARY_TEMPLATE_KEYS.has(existing.templateKey)
    || existing.stationType === "EYE_HEALTH"
  ) {
    throw new AppError(
      422,
      "STATION_TEMPLATE_NOT_EDITABLE",
      "Registration, clinical review, and eye health are not managed in the station library",
    );
  }
  let fieldSchema;
  if (body.fieldSchema !== undefined) {
    if (!SCHEMA_DRIVEN_STATION_TYPES.has(existing.stationType)) {
      throw new AppError(
        422,
        "FIELD_SCHEMA_NOT_EDITABLE",
        "Field schemas can only be edited for custom and clinical screening stations",
      );
    }
    try {
      fieldSchema = SCHEMA_DRIVEN_STATION_TYPES.has(existing.stationType) && existing.stationType !== "CUSTOM"
        ? assertClinicalFieldSchema(existing.stationType, body.fieldSchema)
        : parseFieldSchema(body.fieldSchema);
    } catch (error) {
      throw new AppError(422, "INVALID_FIELD_SCHEMA", error.message);
    }
  }
  const template = await tx.stationTemplate.update({
    where: { stationTemplateId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.defaultCapacity !== undefined ? { defaultCapacity: body.defaultCapacity } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(fieldSchema !== undefined ? { fieldSchema } : {}),
      version: { increment: 1 },
    },
  });
  const serialized = serializeStationTemplate(template);
  await createAuditLog({
    userId: user.userId,
    action: existing.active && body.active === false ? "STATION_TEMPLATE_DEACTIVATED" : "STATION_TEMPLATE_UPDATED",
    entityName: "StationTemplate",
    entityId: stationTemplateId,
    oldValue: serializeStationTemplate(existing),
    newValue: serialized,
    context,
    client: tx,
  });
  return serialized;
});

const importStations = async (eventId, body, user, correlationId, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  assertStationPlanningState(current);

  const templates = await db.stationTemplate.findMany({
    where: { stationTemplateId: { in: body.stationTemplateIds }, active: true },
  });
  if (templates.length !== body.stationTemplateIds.length) {
    throw new AppError(422, "STATION_TEMPLATE_NOT_AVAILABLE", "One or more station templates are unavailable");
  }

  const orderedTemplates = body.stationTemplateIds.map((id) => templates.find((template) => template.stationTemplateId === id));
  const { importable, skipped } = classifyTemplates(orderedTemplates);
  if (skipped.length > 0) {
    const names = skipped.map((template) => template.name).join(", ");
    throw new AppError(
      422,
      "STATION_TEMPLATE_NOT_IMPORTABLE",
      `These templates are not screening stations and cannot be imported: ${names}`,
    );
  }
  try {
    assertImportableBatch(importable);
  } catch (error) {
    throw new AppError(422, error.code || "DUPLICATE_STATION_TYPE", error.message);
  }

  const existingStations = current.stations || [];
  const newCount = importable.filter(({ template, stationType }) => !findExistingStation(existingStations, {
    stationType,
    stationTemplateId: template.stationTemplateId,
  })).length;
  if (existingStations.length + newCount > 50) {
    throw new AppError(422, "STATION_LIMIT_EXCEEDED", "An event can have at most 50 stations");
  }

  return db.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);

    let nextOrder = existingStations.reduce((max, station) => Math.max(max, station.stationOrder), 0);
    for (const { template, stationType } of importable) {
      const schemaFields = stationSchemaFields(template);
      const existing = findExistingStation(existingStations, {
        stationType,
        stationTemplateId: template.stationTemplateId,
      });
      if (existing) {
        await tx.station.update({
          where: { stationId: existing.stationId },
          data: {
            stationName: template.name,
            stationTemplateId: template.stationTemplateId,
            isActive: true,
            ...schemaFields,
          },
        });
      } else {
        if (CLINICAL_ONE_PER_EVENT_TYPES.includes(stationType)
          && existingStations.some((station) => station.stationType === stationType)) {
          throw new AppError(422, "DUPLICATE_STATION_TYPE", "Choose only one template for each screening station type");
        }
        nextOrder += 1;
        const created = await tx.station.create({
          data: {
            eventId,
            stationTemplateId: template.stationTemplateId,
            stationType,
            stationName: template.name,
            stationOrder: nextOrder,
            isActive: true,
            ...schemaFields,
          },
        });
        existingStations.push(created);
      }
    }

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "UPDATED",
        resource: "Event",
        entityName: "Event",
        entityId: eventId,
        details: { oldValue: snapshot(current), newValue: snapshot(updated) },
        ...await auditFields(tx, user, correlationId),
      },
    });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user, tx);
  });
};

const updateStation = async (eventId, eventStationId, body, user, correlationId, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  assertStationPlanningState(current);
  const stations = current.stations || [];
  const station = stations.find((candidate) => candidate.stationId === eventStationId);
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Event station was not found");
  if (body.stationOrder !== undefined && body.stationOrder > stations.length) {
    throw new AppError(422, "INVALID_STATION_ORDER", "Station order must be within the event station list");
  }

  return db.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);

    if (body.stationOrder !== undefined && body.stationOrder !== station.stationOrder) {
      const displaced = stations.find((candidate) => candidate.stationOrder === body.stationOrder);
      if (!displaced) throw new AppError(422, "INVALID_STATION_ORDER", "Station order must be within the event station list");
      const tempOrder = stations.length + 1;
      await tx.station.update({
        where: { stationId: displaced.stationId },
        data: { stationOrder: tempOrder },
      });
      await tx.station.update({
        where: { stationId: eventStationId },
        data: { stationOrder: body.stationOrder },
      });
      await tx.station.update({
        where: { stationId: displaced.stationId },
        data: { stationOrder: station.stationOrder },
      });
    }

    if (body.isAvailable !== undefined) {
      await tx.station.update({
        where: { stationId: eventStationId },
        data: { isActive: body.isAvailable },
      });
    }

    if (body.operationalStatus !== undefined) {
      await tx.station.update({
        where: { stationId: eventStationId },
        data: { operationalStatus: body.operationalStatus },
      });
    }

    // body.capacity accepted for OpenAPI/UI compatibility; Station has no capacity column (#30 MVP).
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "UPDATED",
        resource: "Event",
        entityName: "Event",
        entityId: eventId,
        details: { oldValue: snapshot(current), newValue: snapshot(updated) },
        ...await auditFields(tx, user, correlationId),
      },
    });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user, tx);
  });
};

const addStaffAssignment = async (eventId, shiftId, body, user, correlationId, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status)) {
    throw new AppError(409, "STAFFING_NOT_EDITABLE", "Staffing cannot be changed for a completed or cancelled event");
  }
  const shift = current.shifts.find((candidate) => candidate.shiftId === shiftId);
  if (!shift) throw new AppError(404, "SHIFT_NOT_FOUND", "Shift was not found");
  const station = body.eventStationId
    ? current.stations.find((candidate) => candidate.stationId === body.eventStationId && candidate.isActive)
    : null;
  if (body.eventStationId && !station) {
    throw new AppError(422, "STATION_NOT_AVAILABLE", "The selected event station is unavailable");
  }

  return db.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);
    await lockStaffSchedules(tx, [body.userId]);

    const activeUser = await tx.user.findFirst({
      where: {
        id: body.userId,
        status: "ACTIVE",
        approvalState: "APPROVED",
        accessState: "ENABLED",
        deprovisionedAt: null,
        eventMemberships: {
          some: { eventId, status: "ACTIVE", roles: { some: { role: body.assignmentRole } } },
        },
      },
      select: {
        id: true,
        professionalCategory: true,
        userRoles: { select: { role: { select: { roleName: true } } } },
      },
    });
    if (!activeUser) throw new AppError(422, "STAFF_NOT_AVAILABLE", "The selected staff member is unavailable");
    assertRoleEligibility(activeUser, [body.assignmentRole]);

    // Same shift + different station is allowed (VA / refraction / colour vision).
    // Conflict only when another overlapping shift already has this person, or this
    // exact shift+station slot is already taken.
    const conflict = await tx.staffAssignment.findFirst({
      where: {
        userId: body.userId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        OR: [
          {
            shiftId: { not: shiftId },
            shift: { startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } },
          },
          {
            shiftId,
            stationId: station?.stationId || null,
          },
        ],
      },
      select: { id: true },
    });
    if (conflict) throw scheduleConflictError();

    const assignment = await tx.staffAssignment.create({
      data: {
        eventId,
        shiftId,
        userId: body.userId,
        stationId: station?.stationId || null,
        assignedBy: user.userId,
        assignmentRole: body.assignmentRole,
        notes: body.notes || null,
        assignmentStatus: "ASSIGNED",
        status: "ASSIGNED",
      },
    });
    await enqueueAccountLifecycle({
      type: "EVENT_ASSIGNMENT",
      account: { id: body.userId },
      metadata: { eventId, eventName: current.name, roles: [body.assignmentRole] },
      idempotencyKey: `EVENT_ASSIGNMENT:DUTY:${assignment.id}`,
      db: tx,
    });

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "STAFF_ASSIGNMENT_ADDED",
        resource: "Event",
        entityName: "Event",
        entityId: eventId,
        details: { shiftId, assignmentRole: body.assignmentRole, assignedUserId: body.userId },
        ...await auditFields(tx, user, correlationId),
      },
    });
    return toEventResponse(updated, user, tx);
  });
};

const removeStaffAssignment = async (eventId, shiftId, assignmentId, version, user, correlationId, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status)) {
    throw new AppError(409, "STAFFING_NOT_EDITABLE", "Staffing cannot be changed for a completed or cancelled event");
  }
  const assignment = current.shifts
    .find((shift) => shift.shiftId === shiftId)
    ?.staffAssignments.find((candidate) => candidate.id === assignmentId);
  if (!assignment) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Staff assignment was not found");

  return db.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, version);
    const assignment = await tx.staffAssignment.findFirst({
      where: { id: assignmentId, shiftId, shift: { eventId } },
      select: { id: true },
    });

    if (!assignment) {
      throw new AppError(
        404,
        "ASSIGNMENT_NOT_FOUND",
        "Staff assignment was not found"
      );
    }

    await tx.staffAssignment.delete({
      where: { id: assignmentId },
    });

    const updated = await tx.event.findUniqueOrThrow({
      where: { eventId },
      include: eventInclude,
    });

    await auditUpdate(tx, current, updated, user, correlationId);
    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "STAFF_ASSIGNMENT_REMOVED",
        resource: "Event",
        entityName: "Event",
        entityId: eventId,
        details: { shiftId, assignmentId },
        ...await auditFields(tx, user, correlationId),
      },
    });
    return toEventResponse(updated, user, tx);
  });
};

const getAuditLog = async (eventId, query, user, db = prisma) => {
  await requireEvent(eventId, user, true, db);
  const scope = `event-audit:${eventId}:${query.limit}`;
  const cursor = decodeCursor(query.cursor, scope);
  const usesEventAuditLog = Boolean(db.eventAuditLog);
  const recordId = usesEventAuditLog ? "eventAuditLogId" : "id";
  const filters = usesEventAuditLog
    ? { eventId }
    : { entityName: "Event", entityId: eventId };
  const rows = await (usesEventAuditLog ? db.eventAuditLog : db.auditLog).findMany({
    where: cursor ? {
      AND: [
        filters,
        {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), [recordId]: { lt: cursor.id } },
          ],
        },
      ],
    } : filters,
    include: {
      [usesEventAuditLog ? "actor" : "user"]: {
        select: {
          id: true,
          fullName: true,
          email: true,
          status: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { [recordId]: "desc" }],
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const auditLogs = hasMore ? rows.slice(0, query.limit) : rows;
  const last = auditLogs.at(-1);

  return {
    auditLogs,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            scope,
            createdAt: last.createdAt.toISOString(),
            id: last[recordId],
          })
        : null,
  };
};

const publicEventStatuses = ["PUBLISHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const dateTime = (value) => value ? value.toISOString() : null;
const attendeeSelect = {
  registrationId: true,
  participantDisplayName: true,
  registrationStatus: true,
  checkedIn: true,
  checkedInAt: true,
  queueNumber: true,
  createdAt: true,
  participant: { select: { participantReference: true } },
};
const attendeeProjection = ({ participant, ...registration }) => ({
  ...registration,
  participantReference: participant.participantReference,
  checkedInAt: dateTime(registration.checkedInAt),
  createdAt: dateTime(registration.createdAt),
});

const publicEventProjection = (event) => ({
  eventId: event.eventId,
  name: event.name,
  description: event.description,
  bannerKey: event.bannerKey,
  artworkDataUrl: event.artworkDataUrl,
  venue: event.venue,
  address: event.address,
  postalCode: event.postalCode,
  timezone: event.timezone,
  startsAt: dateTime(event.startsAt),
  endsAt: dateTime(event.endsAt),
  capacity: event.capacity,
  status: event.status,
  eventDays: (event.eventDays || []).map((day) => ({
    eventDayId: day.eventDayId,
    date: day.date.toISOString().slice(0, 10),
    startsAt: dateTime(day.startsAt),
    endsAt: dateTime(day.endsAt),
  })),
});

const metricsForEvent = async (event, db = prisma) => {
  const registrationWhere = { eventId: event.eventId };
  const [signupCount, checkedInCount, completedCount, cancelledCount, activeCount, screeningResultCount, flaggedResultCount, referralCount] = await Promise.all([
    db.eventRegistration.count({ where: { ...registrationWhere, registrationStatus: { not: "CANCELLED" } } }),
    db.eventRegistration.count({ where: attendanceWhere(event.eventId) }),
    db.eventRegistration.count({ where: { ...registrationWhere, registrationStatus: "COMPLETED" } }),
    db.eventRegistration.count({ where: { ...registrationWhere, registrationStatus: "CANCELLED" } }),
    db.eventRegistration.count({ where: { ...registrationWhere, registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] } } }),
    db.screeningResult.count({ where: { registration: { eventId: event.eventId } } }),
    db.screeningResult.count({ where: { registration: { eventId: event.eventId }, isFlagged: true } }),
    db.referral.count({ where: { review: { registration: { eventId: event.eventId } } } }),
  ]);
  return {
    signupCount,
    checkedInCount,
    completedCount,
    cancelledCount,
    activeCount,
    attendanceRatePercent: signupCount ? Math.round((checkedInCount / signupCount) * 100) : 0,
    screeningResultCount,
    flaggedResultCount,
    referralCount,
    capacity: event.capacity,
    expectedAttendance: event.expectedAttendance,
  };
};

const getPublicEvent = async (eventId, db = prisma) => {
  const event = await db.event.findFirst({
    where: { eventId, status: { in: publicEventStatuses } },
    select: {
      eventId: true,
      name: true,
      description: true,
      bannerKey: true,
      artworkDataUrl: true,
      venue: true,
      address: true,
      postalCode: true,
      timezone: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      status: true,
      eventDays: { orderBy: { date: "asc" }, select: { eventDayId: true, date: true, startsAt: true, endsAt: true } },
    },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
  return publicEventProjection(event);
};

const getEventMetrics = async (eventId, user, db = prisma) => metricsForEvent(await requireEvent(eventId, user, true, db), db);

const listEventAttendees = async (eventId, query, user, db = prisma) => {
  await requireEvent(eventId, user, true, db);
  const limit = query.limit ?? 50;
  const scope = `event-attendees:${eventId}:${query.status || "all"}:${query.search || ""}:${limit}`;
  const cursor = decodeCursor(query.cursor, scope);
  const filters = {
    eventId,
    ...(query.status ? { registrationStatus: query.status } : {}),
    ...(query.search ? {
      OR: [
        { participantDisplayName: { contains: query.search, mode: "insensitive" } },
        { participant: { participantReference: { contains: query.search, mode: "insensitive" } } },
      ],
    } : {}),
  };
  const where = cursor ? {
    AND: [filters, {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), registrationId: { lt: cursor.registrationId } },
      ],
    }],
  } : filters;
  const [total, rows] = await Promise.all([
    db.eventRegistration.count({ where: filters }),
    db.eventRegistration.findMany({
      where,
      select: attendeeSelect,
      orderBy: [{ createdAt: "desc" }, { registrationId: "desc" }],
      take: limit + 1,
    }),
  ]);
  const hasMore = rows.length > limit;
  const attendees = hasMore ? rows.slice(0, limit) : rows;
  const last = attendees.at(-1);
  return {
    total,
    attendees: attendees.map(attendeeProjection),
    nextCursor: hasMore && last ? encodeCursor({ scope, createdAt: last.createdAt.toISOString(), registrationId: last.registrationId }) : null,
  };
};

const exportEventSelect = {
  eventId: true, name: true, description: true, bannerKey: true, artworkDataUrl: true,
  venue: true, address: true, postalCode: true, timezone: true, startsAt: true, endsAt: true,
  capacity: true, expectedAttendance: true, status: true, version: true,
  eventDays: {
    orderBy: { date: "asc" },
    select: {
      eventDayId: true, date: true, startsAt: true, endsAt: true,
      stationAvailabilities: {
        orderBy: [{ eventStationId: "asc" }, { eventStationAvailabilityId: "asc" }],
        select: {
          eventStationAvailabilityId: true, eventStationId: true, eventDayId: true,
          isAvailable: true, startsAt: true, endsAt: true, capacity: true,
        },
      },
    },
  },
  stations: { orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }], select: { stationId: true, stationName: true, stationType: true, stationOrder: true, isActive: true } },
  shifts: { orderBy: [{ startsAt: "asc" }, { shiftId: "asc" }], select: { shiftId: true, name: true, startsAt: true, endsAt: true, requiredStaff: true, status: true } },
  staffAssignments: {
    orderBy: { id: "asc" },
    select: { id: true, eventId: true, stationId: true, shiftId: true, userId: true, assignedBy: true, assignedAt: true, assignmentRole: true, assignmentStatus: true, status: true },
  },
  registrations: { orderBy: [{ createdAt: "desc" }, { registrationId: "desc" }], select: attendeeSelect },
};

const exportSnapshot = async (eventId, db = prisma) => {
  const event = await db.event.findUnique({
    where: { eventId },
    select: exportEventSelect,
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
  const { eventDays, stations, shifts, staffAssignments, registrations, ...eventFields } = event;
  return {
    event: { ...eventFields, startsAt: dateTime(event.startsAt), endsAt: dateTime(event.endsAt) },
    metrics: await metricsForEvent(event, db),
    eventDays: (eventDays || []).map(({ stationAvailabilities = [], ...day }) => ({
      ...day,
      date: day.date.toISOString().slice(0, 10),
      startsAt: dateTime(day.startsAt),
      endsAt: dateTime(day.endsAt),
      stationAvailabilities: stationAvailabilities.map((availability) => ({
        ...availability,
        startsAt: dateTime(availability.startsAt),
        endsAt: dateTime(availability.endsAt),
      })),
    })),
    stations: stations || [],
    shifts: (shifts || []).map((shift) => ({ ...shift, startsAt: dateTime(shift.startsAt), endsAt: dateTime(shift.endsAt) })),
    staffAssignments: (staffAssignments || []).map(({ assignedAt, notes: _notes, ...assignment }) => ({
      ...assignment,
      assignedAt: dateTime(assignedAt),
    })),
    attendees: (registrations || []).map(attendeeProjection),
  };
};

const exportHashFor = (snapshot) => crypto
  .createHash("sha256")
  .update(JSON.stringify({ schemaVersion: 1, ...snapshot }))
  .digest("hex");

const exportEvent = async (eventId, user, db = prisma) => {
  await requireEvent(eventId, user, true, db);
  const snapshot = await exportSnapshot(eventId, db);
  const exportHash = exportHashFor(snapshot);
  return {
    export: { schemaVersion: 1, generatedAt: new Date().toISOString(), ...snapshot },
    exportReceipt: createExportReceipt({
      eventId,
      version: snapshot.event.version,
      actorUserId: user.userId,
      exportHash,
      secret: env.jwtAccessSecret,
    }),
  };
};

module.exports = {
  createEvent,
  listEvents,
  listActiveEvents,
  getEvent,
  updateEvent,
  transitionEvent,
  cancelEvent,
  previewEventDeletion,
  deleteEvent,
  getEventDeletionCleanupStatus,
  listStaffDirectory,
  listStationTemplates,
  listStationTemplateLibrary,
  createStationTemplate,
  updateStationTemplate,
  importStations,
  updateStation,
  addStaffAssignment,
  removeStaffAssignment,
  getAuditLog,
  getPublicEvent,
  getEventMetrics,
  metricsForEvent,
  listEventAttendees,
  exportEvent,
  exportSnapshot,
  exportHashFor,
  __deletionTest: { impactDigest, signDeletionPreview, verifyDeletionPreview },
};
