const prisma = require("../prisma/prismaClient");
const crypto = require("crypto");
const AppError = require("../errors/AppError");
const { encodeCursor, decodeCursor } = require("../utils/cursor");
const env = require("../config/env");
const { createExportReceipt, verifyExportReceipt } = require("../utils/eventExportReceipt");

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
  const hasAssignedPerson = (event.shifts || []).some((shift) =>
    (shift.staffAssignments || []).some((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status || assignment.assignmentStatus))
  );
  if (!hasStation || !hasAssignedPerson) {
    throw new AppError(422, "EVENT_NOT_READY", "Add at least one station and assign at least one person before publishing");
  }
};
const auditFields = (context) => {
  const value = typeof context === "string" ? { requestId: context } : context || {};
  return {
    requestId: value.requestId || null,
    ipAddress: value.ipAddress || null,
    deviceName: value.deviceName || null,
  };
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
    capacity: station.capacity ?? event.capacity,
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
      eventStationId: assignment.eventStation?.eventStationId || assignment.station?.stationId || assignment.stationId || null,
        status: assignment.status || assignment.assignmentStatus,
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
          station: { select: { stationId: true, stationName: true, stationOrder: true } },
        },
      },
    },
  },
  stations: {
    orderBy: { stationOrder: "asc" },
    select: {
      stationId: true,
      stationName: true,
      stationType: true,
      stationOrder: true,
      isActive: true,
    },
  },
  createdBy: { select: { id: true, username: true, fullName: true, email: true, sysRole: true, status: true } },
  cancelledBy: { select: { id: true, username: true, fullName: true, email: true, sysRole: true, status: true } },
  registrations: {
    where: { registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] } },
    select: { registrationId: true },
  },
  _count: {
    select: {
      registrations: { where: { registrationStatus: { not: "CANCELLED" } } },
    },
  },
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
  createdBy: { select: { userId: true, username: true, email: true, systemRole: true, status: true } },
  cancelledBy: { select: { userId: true, username: true, email: true, systemRole: true, status: true } },
  registrations: {
    where: { status: { in: ["SIGNED_UP", "CHECKED_IN"] } },
    select: { registrationId: true },
  },
  _count: {
    select: {
      registrations: { where: { registrationStatus: { not: "CANCELLED" } } },
    },
  },
};

const publicUser = (value, detailed = false) => value ? {
  userId: value.id,
  username: value.username || value.fullName || value.email,
  ...(detailed ? { email: value.email, systemRole: value.sysRole, status: value.status } : {}),
} : null;

const toEventResponse = ({ _count = {}, registrations = [], stations = [], ...event }, user) => {
  const manageable = user ? canManage(event, user) : false;
  const shifts = (event.shifts || []).map((shift) => ({
    ...shift,
    staffAssignments: (shift.staffAssignments || []).map(({ assignedUser, station, notes, ...assignment }) => ({
      ...assignment,
      ...(manageable ? { notes } : {}),
      staffAssignmentId: assignment.id,
      user: {
        userId: assignedUser.id,
        username: assignedUser.username || assignedUser.fullName || assignedUser.email,
      },
      eventStation: station ? {
        eventStationId: station.stationId,
        stationTemplateId: station.stationId,
        name: station.stationName,
        stationOrder: station.stationOrder,
      } : null,
    })),
  }));
  const eventStations = stations.map((station) => ({
    eventStationId: station.stationId,
    stationTemplateId: station.stationId,
    templateVersion: 1,
    name: station.stationName,
    description: station.stationType,
    stationOrder: station.stationOrder,
    capacity: event.capacity,
    isAvailable: station.isActive,
    availabilities: [],
  }));
  const registrationCount = _count.registrations || 0;
  return {
    ...event,
    id: event.eventId,
    eventName: event.name,
    location: event.venue,
    eventDate: event.startsAt,
    startTime: event.startsAt,
    endTime: event.endsAt,
    eventDays: (event.eventDays || []).map((day) => ({
      ...day,
      date: day.date instanceof Date ? day.date.toISOString().slice(0, 10) : String(day.date).slice(0, 10),
    })),
    shifts,
    eventStations,
    createdBy: publicUser(event.createdBy, manageable),
    cancelledBy: publicUser(event.cancelledBy, manageable),
    signupCount: registrationCount,
    activeCapacityCount: registrations.length,
    _count: { eventRegistrations: registrationCount },
    canManage: manageable,
  };
};

const visibilityWhere = (user) => {
  // Assuming SUPER_ADMIN handles full access based on your schema enum SystemRole
  if (user.systemRole === "SUPER_ADMIN" || user.systemRole === "ADMIN") return {};
  const assigned = {
    staffAssignments: {
      some: { userId: user.userId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
    },
  };
  return user.systemRole === "EVENT_MANAGER"
    ? { OR: [{ createdByUserId: user.userId }, assigned] }
    : assigned;
};

const loadEventWithAssignment = (eventId, user, db = prisma) =>
  db.event.findFirst({
    where: { eventId, ...visibilityWhere(user) },
    include: eventInclude,
  });

const canManage = (event, user) =>
  user.systemRole === "SUPER_ADMIN" ||
  user.systemRole === "ADMIN" ||
  (user.systemRole === "EVENT_MANAGER" &&
    (event.createdByUserId === user.userId ||
      event.shifts.some((shift) =>
        shift.staffAssignments.some(
          (assignment) =>
            assignment.userId === user.userId &&
            assignment.assignmentRole === "EVENT_MANAGER" &&
            ["ASSIGNED", "CONFIRMED"].includes(assignment.status)
        )
      )));

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

const assertRange = (data, shifts, days = []) => {
  if (data.endsAt <= data.startsAt) throw new AppError(422, "INVALID_EVENT_RANGE", "Event end must be after its start");
  for (const day of days) {
    if (new Date(day.startsAt) < data.startsAt || new Date(day.endsAt) > data.endsAt) {
      throw new AppError(422, "INVALID_EVENT_DAY_RANGE", "Every event day must be within the event schedule");
    }
  }
  for (const shift of shifts) {
    if (new Date(shift.startsAt) < data.startsAt || new Date(shift.endsAt) > data.endsAt) {
      throw new AppError(422, "INVALID_SHIFT_RANGE", "Every shift must be within the event schedule");
    }
  }
};

const assertShiftSchedulesAvailable = async (tx, eventId, desiredShifts, currentShifts) => {
  const desiredById = new Map(desiredShifts.filter((shift) => shift.shiftId).map((shift) => [shift.shiftId, shift]));
  const schedules = currentShifts.flatMap((shift) => {
    const desired = desiredById.get(shift.shiftId);
    if (!desired) return [];
      return shift.staffAssignments
      .filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status))
      .map((assignment) => ({
        userId: assignment.user?.userId || assignment.assignedUser?.id || assignment.userId,
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
    select: { staffAssignmentId: true },
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
    correlationId,
  },
});

const assertStationPlanningState = (event) => {
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(event.status)) {
    throw new AppError(409, "STATIONS_NOT_EDITABLE", "Stations cannot be changed for a completed or cancelled event");
  }
};

const requireTemplates = async (tx, stations) => {
  const ids = [...new Set((stations || []).map((station) => station.stationTemplateId))];
  if (ids.length === 0) return new Map();
  const templates = await tx.stationTemplate.findMany({ where: { stationTemplateId: { in: ids }, active: true } });
  if (templates.length !== ids.length) {
    throw new AppError(422, "STATION_TEMPLATE_NOT_AVAILABLE", "One or more station templates are unavailable");
  }
  return new Map(templates.map((template) => [template.stationTemplateId, template]));
};

const assertAssignmentSchedulesAvailable = async (tx, eventId, shifts) => {
  const schedules = shifts.flatMap((shift) => (shift.assignments || []).map((assignment) => ({
    userId: assignment.userId,
    startsAt: new Date(shift.startsAt),
    endsAt: new Date(shift.endsAt),
  })));
  if (schedules.length === 0) return;
  await lockStaffSchedules(tx, schedules.map(({ userId }) => userId));

  const activeUsers = await tx.user.count({
    where: { userId: { in: [...new Set(schedules.map(({ userId }) => userId))] }, status: "ACTIVE" },
  });
  if (activeUsers !== new Set(schedules.map(({ userId }) => userId)).size) {
    throw new AppError(422, "STAFF_NOT_AVAILABLE", "One or more selected staff members are unavailable");
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
    select: { staffAssignmentId: true },
  });
  if (conflict) throw scheduleConflictError();
};

const createEventDays = async (tx, eventId, days) => {
  const created = [];
  for (const day of days || []) created.push(await tx.eventDay.create({ data: normalizeEventDay(day, eventId) }));
  return new Map(created.map((day) => [day.date.toISOString().slice(0, 10), day]));
};

const createEventStations = async (tx, eventId, stations, daysByDate, templatesById) => {
  const stationsByTemplate = new Map();
  for (const input of stations || []) {
    const template = templatesById.get(input.stationTemplateId);
    const station = await tx.eventStation.create({
      data: {
        eventId,
        stationTemplateId: template.stationTemplateId,
        templateVersion: template.version,
        name: template.name,
        description: template.description,
        stationOrder: input.stationOrder,
        capacity: input.capacity,
        isAvailable: input.isAvailable,
      },
    });
    stationsByTemplate.set(input.stationTemplateId, station);
    for (const availability of input.availabilities) {
      const day = daysByDate.get(availability.date);
      if (!day) throw new AppError(422, "INVALID_STATION_DAY", "Station availability must match an event date");
      await tx.eventStationAvailability.create({
        data: {
          eventStationId: station.eventStationId,
          eventDayId: day.eventDayId,
          isAvailable: availability.isAvailable,
          startsAt: availability.isAvailable ? new Date(availability.startsAt) : null,
          endsAt: availability.isAvailable ? new Date(availability.endsAt) : null,
          capacity: availability.capacity,
        },
      });
    }
  }
  return stationsByTemplate;
};

const createShiftAssignments = async (tx, eventId, shiftInputs, stationsByTemplate, assignedByUserId) => {
  await assertAssignmentSchedulesAvailable(tx, eventId, shiftInputs);
  const savedShifts = await tx.shift.findMany({ where: { eventId } });
  for (const input of shiftInputs) {
    if (input.assignments === undefined) continue;
    const saved = input.shiftId
      ? savedShifts.find((shift) => shift.shiftId === input.shiftId)
      : savedShifts.find((shift) => shift.name === input.name && shift.startsAt.getTime() === new Date(input.startsAt).getTime());
    if (!saved) throw new AppError(422, "INVALID_SHIFT", "A shift could not be matched to the event");
    const existingAssignments = await tx.staffAssignment.findMany({ where: { shiftId: saved.shiftId } });
    for (const assignment of input.assignments) {
      if (assignment.staffAssignmentId && !existingAssignments.some((current) => (
        current.staffAssignmentId === assignment.staffAssignmentId && current.userId === assignment.userId
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
          shiftId: saved.shiftId,
          userId: assignment.userId,
          eventStationId: station?.eventStationId || null,
          assignmentRole: assignment.assignmentRole,
          notes: assignment.notes || null,
          status: "ASSIGNED",
          assignedByUserId,
        },
      });
    }
  }
};

const assertSupportedPlan = (body) => {
  if ((body.stations || []).length || (body.shifts || []).some((shift) => (shift.assignments || []).length)) {
    throw new AppError(501, "EVENT_PLAN_NOT_AVAILABLE", "Station and staff-assignment plan changes are not available yet");
  }
};

const createEvent = async (body, user, context, rawIdempotencyKey, db = prisma) => {
  if (!["ADMIN", "EVENT_MANAGER"].includes(user.systemRole)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to create events");
  }
  assertSupportedPlan(body);
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
    const created = await tx.event.create({
      data: {
        ...eventData,
        createdByUserId: user.userId,
        createIdempotencyKey: idempotencyKey,
        createPayloadHash: idempotencyKey ? payloadHash : null,
        shifts: { create: body.shifts.map((shift) => ({ ...normalizeShift(shift), eventId: undefined })) },
      },
    });
    await createEventDays(tx, created.eventId, body.eventDays);
    const saved = await tx.event.findUniqueOrThrow({ where: { eventId: created.eventId }, include: eventInclude });

    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "CREATED",
        entityName: "Event",
        entityId: created.eventId,
        ...auditFields(context),
        newValue: snapshot(saved),
      },
    });
    return toEventResponse(saved, user);
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
    events: events.map((event) => toEventResponse(event, user)),
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

const getEvent = async (eventId, user) => toEventResponse(await requireEvent(eventId, user), user);

const editableEventKeys = new Set([
  "name", "description", "bannerKey", "artworkDataUrl", "venue", "address", "postalCode",
  "latitude", "longitude", "locationProvider", "locationReference", "timezone", "startsAt",
  "endsAt", "capacity", "expectedAttendance", "eventDays", "shifts",
]);
const allowedUpdateKeys = {
  DRAFT: editableEventKeys,
  PUBLISHED: editableEventKeys,
  IN_PROGRESS: new Set([
    "description",
    "bannerKey",
    "artworkDataUrl",
    "capacity",
  ]),
  COMPLETED: new Set(["bannerKey", "artworkDataUrl"]),
  CANCELLED: new Set(["bannerKey", "artworkDataUrl"]),
};

const updateEvent = async (eventId, body, user, context, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  assertSupportedPlan(body);
  const suppliedKeys = Object.keys(body).filter(
    (key) => key !== "version" && !(key === "stations" && body.stations.length === 0)
  );

  if (suppliedKeys.some((key) => !allowedUpdateKeys[current.status]?.has(key))) {
    throw new AppError(
      409,
      "EVENT_NOT_EDITABLE",
      "One or more fields cannot be changed in the current event state"
    );
  }

  if (
    current.status === "IN_PROGRESS" &&
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
  assertRange(combined, desiredShifts, body.eventDays || current.eventDays);

return db.$transaction(async (tx) => {
  const changed = await tx.event.updateMany({
    where: { eventId, version: body.version },
    data: { ...normalizeEventData(body), version: { increment: 1 } },
  });

  if (changed.count !== 1) {
    throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
  }

  if (body.eventDays) {
    await tx.eventStationAvailability.deleteMany({ where: { eventDay: { eventId } } });
    await tx.eventDay.deleteMany({ where: { eventId } });
    await createEventDays(tx, eventId, body.eventDays);
  }

  const stationsByTemplate = new Map();

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
      entityName: "Event",
      entityId: eventId,
      ...auditFields(context),
      oldValue: snapshot(current),
      newValue: snapshot(updated),
    },
  });

  return toEventResponse(updated, user);
});
};

const transitionEvent = async (eventId, command, body, user, context, db = prisma) => {
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
        ...auditFields(context),
        oldValue: snapshot(current),
        newValue: snapshot(updated),
      },
    });

    return toEventResponse(updated, user);
  });
};

const cancelEvent = async (eventId, body, user, context, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);

  if (
    !["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status) ||
    (current.status === "IN_PROGRESS" && !["SUPER_ADMIN", "ADMIN"].includes(user.systemRole))
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
        ...auditFields(context),
        oldValue: snapshot(current),
        newValue: snapshot(updated),
      },
    });

    return toEventResponse(updated, user);
  });
};

const listStaffDirectory = async () => {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, username: true, fullName: true, email: true, sysRole: true },
    orderBy: { fullName: "asc" },
    take: 200,
  });
  return users.map((user) => ({
    userId: user.id,
    username: user.username || user.fullName || user.email,
    systemRole: user.sysRole,
  }));
};

// Read-only catalog for the events UI / OpenAPI StationTemplate DTO (#23).
// Import/update remain stubbed until #24; templateKey→StationType mapping is #30
// (catalog keys include REGISTRATION / CLINICAL_REVIEW which are not StationType).
const listStationTemplates = async () => {
  const templates = await prisma.stationTemplate.findMany({
    where: { active: true },
    select: {
      stationTemplateId: true,
      templateKey: true,
      version: true,
      name: true,
      description: true,
      defaultCapacity: true,
    },
    orderBy: { name: "asc" },
  });
  return templates;
};

const stationTemplatesUnavailable = async () => {
  throw new AppError(
    501,
    "STATION_TEMPLATES_NOT_AVAILABLE",
    "Station-template import/update is not available yet"
  );
};
const importStations = stationTemplatesUnavailable;
const updateStation = stationTemplatesUnavailable;
const addStaffAssignment = stationTemplatesUnavailable;

const removeStaffAssignment = async (eventId, shiftId, assignmentId, version, user, context, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status)) {
    throw new AppError(409, "STAFFING_NOT_EDITABLE", "Staffing cannot be changed for a completed or cancelled event");
  }
  const assignment = current.shifts
    .find((shift) => shift.shiftId === shiftId)
    ?.staffAssignments.find((candidate) => candidate.id === assignmentId);
  if (!assignment) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Staff assignment was not found");

  return db.$transaction(async (tx) => {
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

    const changed = await tx.event.updateMany({
      where: { eventId, version },
      data: { version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");

    await tx.staffAssignment.delete({
      where: { id: assignmentId },
    });

    const updated = await tx.event.findUniqueOrThrow({
      where: { eventId },
      include: eventInclude,
    });

    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "STAFF_ASSIGNMENT_REMOVED",
        entityName: "Event",
        entityId: eventId,
        ...auditFields(context),
        oldValue: snapshot(current),
        newValue: snapshot(updated),
      },
    });

    return toEventResponse(updated, user);
  });
};

const getAuditLog = async (eventId, query, user, db = prisma) => {
  await requireEvent(eventId, user, true, db);
  const scope = `event-audit:${eventId}:${query.limit}`;
  const cursor = decodeCursor(query.cursor, scope);

  const filters = { entityName: "Event", entityId: eventId };
  const rows = await db.auditLog.findMany({
    where: cursor ? {
      AND: [
        filters,
        {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        },
      ],
    } : filters,
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          status: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
            id: last.id,
          })
        : null,
  };
};

const publicEventStatuses = ["PUBLISHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
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
const dateTime = (value) => value ? value.toISOString() : null;
const attendeeProjection = ({ participant, ...registration }) => ({
  ...registration,
  participantReference: participant.participantReference,
  checkedInAt: dateTime(registration.checkedInAt),
  createdAt: dateTime(registration.createdAt),
});

const metricsForEvent = async (event, db = prisma) => {
  const registrationWhere = { eventId: event.eventId };
  const [signupCount, checkedInCount, completedCount, cancelledCount, activeCount, screeningResultCount, flaggedResultCount, referralCount] = await Promise.all([
    db.eventRegistration.count({ where: { ...registrationWhere, registrationStatus: { not: "CANCELLED" } } }),
    db.eventRegistration.count({ where: { ...registrationWhere, registrationStatus: { not: "CANCELLED" }, checkedIn: true } }),
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
  eventDays: event.eventDays.map((day) => ({
    eventDayId: day.eventDayId,
    date: day.date.toISOString().slice(0, 10),
    startsAt: dateTime(day.startsAt),
    endsAt: dateTime(day.endsAt),
  })),
});

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
      eventDays: {
        orderBy: { date: "asc" },
        select: { eventDayId: true, date: true, startsAt: true, endsAt: true },
      },
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
    AND: [
      filters,
      {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), registrationId: { lt: cursor.registrationId } },
        ],
      },
    ],
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
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    total,
    attendees: page.map(attendeeProjection),
    nextCursor: hasMore && last ? encodeCursor({
      scope,
      createdAt: last.createdAt.toISOString(),
      registrationId: last.registrationId,
    }) : null,
  };
};

const exportEventSelect = {
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
  expectedAttendance: true,
  status: true,
  version: true,
  eventDays: {
    orderBy: { date: "asc" },
    select: {
      eventDayId: true,
      date: true,
      startsAt: true,
      endsAt: true,
      stationAvailabilities: {
        orderBy: [{ eventStationId: "asc" }, { eventStationAvailabilityId: "asc" }],
        select: {
          eventStationAvailabilityId: true,
          eventStationId: true,
          eventDayId: true,
          isAvailable: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
        },
      },
    },
  },
  stations: {
    orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }],
    select: { stationId: true, stationName: true, stationType: true, stationOrder: true, isActive: true },
  },
  shifts: {
    orderBy: [{ startsAt: "asc" }, { shiftId: "asc" }],
    select: { shiftId: true, name: true, startsAt: true, endsAt: true, requiredStaff: true, status: true },
  },
  staffAssignments: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      eventId: true,
      stationId: true,
      shiftId: true,
      userId: true,
      assignedBy: true,
      assignedAt: true,
      assignmentRole: true,
      assignmentStatus: true,
      status: true,
    },
  },
  registrations: {
    orderBy: [{ createdAt: "desc" }, { registrationId: "desc" }],
    select: attendeeSelect,
  },
};

const exportSnapshot = async (eventId, db = prisma) => {
  const event = await db.event.findUnique({ where: { eventId }, select: exportEventSelect });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
  const { eventDays, stations, shifts, staffAssignments, registrations, ...eventFields } = event;
  return {
    event: {
      ...eventFields,
      startsAt: dateTime(event.startsAt),
      endsAt: dateTime(event.endsAt),
    },
    metrics: await metricsForEvent(event, db),
    eventDays: eventDays.map(({ stationAvailabilities, ...day }) => ({
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
    stations,
    shifts: shifts.map((shift) => ({ ...shift, startsAt: dateTime(shift.startsAt), endsAt: dateTime(shift.endsAt) })),
    staffAssignments: staffAssignments.map(({ assignedAt, notes: _notes, ...assignment }) => ({
      ...assignment,
      assignedAt: dateTime(assignedAt),
    })),
    attendees: registrations.map(attendeeProjection),
  };
};

const exportHashFor = (snapshot) => crypto.createHash("sha256").update(JSON.stringify({ schemaVersion: 1, ...snapshot })).digest("hex");

const exportEvent = async (eventId, user) => {
  await requireEvent(eventId, user, true);
  const snapshot = await exportSnapshot(eventId);
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

const invalidReceipt = () => new AppError(409, "INVALID_EXPORT_RECEIPT", "Export receipt is invalid or expired");
const assertDeleteAuthority = (event, user) => {
  if (user.systemRole === "ADMIN") return;
  if (user.systemRole === "EVENT_MANAGER" && event.createdByUserId === user.userId) return;
  throw new AppError(403, "FORBIDDEN", "You do not have permission to delete this event");
};

const deleteEvent = async (eventId, body, user, context, db = prisma) => {
  const audit = auditFields(context);
  const visibleEvent = await requireEvent(eventId, user, true, db);
  assertDeleteAuthority(visibleEvent, user);
  if (!verifyExportReceipt(body.exportReceipt, {
    secret: env.jwtAccessSecret,
    eventId,
    version: body.version,
    actorUserId: user.userId,
  })) throw invalidReceipt();

  await db.$transaction(async (tx) => {
    const current = await tx.event.findUnique({
      where: { eventId },
      select: { eventId: true, name: true, status: true, version: true, createdByUserId: true },
    });
    if (!current) throw new AppError(404, "EVENT_NOT_FOUND", "Event was not found");
    assertDeleteAuthority(current, user);
    if (current.status !== "DRAFT") throw new AppError(409, "EVENT_NOT_DELETABLE", "Only unpopulated draft events can be deleted");
    if (current.name !== body.eventName || current.version !== body.version) {
      throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
    }

    const [registrationCount, consentCount, preservedEventAuditLogs, snapshot] = await Promise.all([
      tx.eventRegistration.count({ where: { eventId } }),
      tx.participantConsent.count({ where: { eventId } }),
      tx.eventAuditLog.count({ where: { eventId } }),
      exportSnapshot(eventId, tx),
    ]);
    if (registrationCount || consentCount) {
      throw new AppError(409, "EVENT_NOT_DELETABLE", "Only unpopulated draft events can be deleted");
    }
    const exportHash = exportHashFor(snapshot);
    if (!verifyExportReceipt(body.exportReceipt, {
      secret: env.jwtAccessSecret,
      eventId,
      version: current.version,
      actorUserId: user.userId,
      exportHash,
    })) throw invalidReceipt();

    await tx.event.delete({ where: { eventId } });
    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "DELETED",
        entityName: "Event",
        entityId: eventId,
        ...audit,
        details: {
          exportHash,
          version: current.version,
          deletedCounts: { events: 1 },
          preservedCounts: { eventAuditLogs: preservedEventAuditLogs },
          requestId: audit.requestId,
        },
      },
    });
  }, { isolationLevel: "Serializable" });
};

module.exports = {
  createEvent,
  listEvents,
  listActiveEvents,
  getEvent,
  updateEvent,
  transitionEvent,
  cancelEvent,
  listStaffDirectory,
  listStationTemplates,
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
  deleteEvent,
  exportSnapshot,
  exportHashFor,
};
