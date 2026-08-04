const prisma = require("../prisma/prismaClient");
const crypto = require("crypto");
const AppError = require("../errors/AppError");
const { encodeCursor, decodeCursor } = require("../utils/cursor");
const {
  classifyTemplates,
  stationTypeForTemplateKey,
} = require("./stationTemplateMapping");
const { ASSIGNMENT_APPLICATION_ROLES } = require("../utils/roles");
const {
  enqueueEventArtifactCleanup,
  processArtifactCleanupTasks,
} = require("./artifactCleanupService");

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
          station: { select: { stationId: true, stationName: true, stationOrder: true, stationType: true } },
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
    // Venue occupancy must be derived from an actual check-in, never from a signup.
    where: { registrationStatus: "CHECKED_IN" },
    select: { registrationId: true, registrationStatus: true },
  },
  _count: { select: { registrations: true } },
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
  _count: { select: { registrations: true } },
};

const publicUser = (value) => value ? {
  userId: value.id,
  username: value.username || value.fullName || value.email,
  email: value.email,
  systemRole: value.sysRole,
  status: value.status,
} : null;

const assignmentUser = (value) => value ? {
  userId: value.id,
  username: value.username || value.fullName || "Staff member",
} : null;

const loadTemplatesByStationType = async (db = prisma) => {
  const templates = await db.stationTemplate.findMany({ where: { active: true } });
  const byType = new Map();
  for (const template of templates) {
    const stationType = stationTypeForTemplateKey(template.templateKey);
    if (stationType) byType.set(stationType, template);
  }
  return byType;
};

const mapStationDto = (station, event, templatesByType) => {
  const template = templatesByType.get(station.stationType);
  return {
    eventStationId: station.stationId,
    // OpenAPI EventStation DTO: id is Station.stationId; template id resolved via #30 mapping.
    stationTemplateId: template?.stationTemplateId || station.stationId,
    templateVersion: template?.version || 1,
    name: station.stationName,
    stationType: station.stationType,
    description: template?.description || station.stationType,
    stationOrder: station.stationOrder,
    // Capacity is not on Station (#30); expose template default until availability is wired.
    capacity: template?.defaultCapacity || event.capacity,
    isAvailable: station.isActive,
    availabilities: [],
  };
};

const toEventResponse = async (event, user, db = prisma) => {
  const { _count = {}, registrations = [], stations = [] } = event;
  const templatesByType = await loadTemplatesByStationType(db);
  const managerView = user ? canManage(event, user) : false;
  const fullShifts = (event.shifts || []).map((shift) => ({
    shiftId: shift.shiftId,
    name: shift.name,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    requiredStaff: shift.requiredStaff,
    status: shift.status,
    staffAssignments: (shift.staffAssignments || []).map(({ assignedUser, station, ...assignment }) => {
      const template = station ? templatesByType.get(station.stationType) : null;
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
    const ownAssignments = shift.staffAssignments.filter((assignment) => (
      assignment.user?.userId === user.userId
      && ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
    ));
    return ownAssignments.length ? [{ ...shift, staffAssignments: ownAssignments }] : [];
  });
  const visibleStationIds = managerView ? null : new Set(shifts.flatMap((shift) => (
    shift.staffAssignments.flatMap((assignment) => assignment.eventStation?.eventStationId || [])
  )));
  const eventStations = stations
    .filter((station) => !visibleStationIds || visibleStationIds.has(station.stationId))
    .map((station) => mapStationDto(station, event, templatesByType));
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
    activeCapacityCount: registrations.filter(({ registrationStatus }) => registrationStatus === "CHECKED_IN").length,
    _count: { eventRegistrations: registrationCount },
    canManage: managerView,
  };
  if (managerView) {
    response.createdBy = publicUser(event.createdBy);
    response.cancelledBy = publicUser(event.cancelledBy);
  }
  return response;
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

const requireEvent = async (eventId, user, manage = false) => {
  const event = await loadEventWithAssignment(eventId, user);
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

const assertRange = (data, shifts) => {
  if (data.endsAt <= data.startsAt) throw new AppError(422, "INVALID_EVENT_RANGE", "Event end must be after its start");
  for (const shift of shifts) {
    if (new Date(shift.startsAt) < data.startsAt || new Date(shift.endsAt) > data.endsAt) {
      throw new AppError(422, "INVALID_SHIFT_RANGE", "Every shift must be within the event schedule");
    }
  }
};

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
    assignmentRole: assignment.assignmentRole,
    startsAt: new Date(shift.startsAt),
    endsAt: new Date(shift.endsAt),
  })));
  if (schedules.length === 0) return;
  await lockStaffSchedules(tx, schedules.map(({ userId }) => userId));

  const activeUsers = await tx.user.findMany({
    where: { id: { in: [...new Set(schedules.map(({ userId }) => userId))] }, status: "ACTIVE" },
    select: { id: true, userRoles: { select: { role: { select: { roleName: true } } } } },
  });
  if (activeUsers.length !== new Set(schedules.map(({ userId }) => userId)).size) {
    throw new AppError(422, "STAFF_NOT_AVAILABLE", "One or more selected staff members are unavailable");
  }
  const rolesByUser = new Map(activeUsers.map((member) => [member.id, new Set(member.userRoles.map(({ role }) => role.roleName))]));
  if (schedules.some(({ userId, assignmentRole }) => {
    const roles = rolesByUser.get(userId);
    return roles?.has("ADMINISTRATOR") || !roles?.has(ASSIGNMENT_APPLICATION_ROLES[assignmentRole]);
  })) {
    throw new AppError(422, "STAFF_ROLE_MISMATCH", "A selected staff member does not hold the required account role");
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

const createEventStations = async (tx, eventId, stations, daysByDate, templatesById) => {
  const stationsByTemplate = new Map();
  const existing = await tx.station.findMany({ where: { eventId }, orderBy: { stationOrder: "asc" } });
  let nextOrder = existing.reduce((max, station) => Math.max(max, station.stationOrder), 0);

  for (const input of stations || []) {
    const template = templatesById.get(input.stationTemplateId);
    const stationType = stationTypeForTemplateKey(template.templateKey);
    if (!stationType) {
      throw new AppError(
        422,
        "STATION_TEMPLATE_NOT_IMPORTABLE",
        `${template.templateKey} cannot be imported as a Station (not a screening StationType)`,
      );
    }

    let station = existing.find((row) => row.stationType === stationType);
    if (station) {
      station = await tx.station.update({
        where: { stationId: station.stationId },
        data: {
          stationName: template.name,
          stationOrder: input.stationOrder,
          isActive: input.isAvailable !== false,
        },
      });
    } else {
      nextOrder = Math.max(nextOrder + 1, input.stationOrder || nextOrder + 1);
      // Prefer requested order when free; otherwise append.
      const orderTaken = existing.some((row) => row.stationOrder === input.stationOrder)
        || [...stationsByTemplate.values()].some((row) => row.stationOrder === input.stationOrder);
      const stationOrder = orderTaken ? nextOrder : (input.stationOrder || nextOrder);
      nextOrder = Math.max(nextOrder, stationOrder);
      station = await tx.station.create({
        data: {
          eventId,
          stationType,
          stationName: template.name,
          stationOrder,
          isActive: input.isAvailable !== false,
        },
      });
      existing.push(station);
    }
    stationsByTemplate.set(input.stationTemplateId, station);

    // Day-level capacity rows optional; create when the wizard supplies availabilities.
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

const createEvent = async (body, user, correlationId, rawIdempotencyKey) => {
  if (!["ADMIN", "EVENT_MANAGER"].includes(user.systemRole)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to create events");
  }
  const idempotencyKey = rawIdempotencyKey && /^[A-Za-z0-9_-]{8,100}$/.test(rawIdempotencyKey) ? rawIdempotencyKey : null;
  if (rawIdempotencyKey && !idempotencyKey) {
    throw new AppError(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain 8 to 100 letters, numbers, underscores, or hyphens");
  }
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return prisma.$transaction(async (tx) => {
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
    assertRange(eventData, body.shifts);
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
        ipAddress: "::1",
        deviceName: "Server",
      },
    });
    await tx.eventAuditLog.create({
      data: {
        eventId: created.eventId,
        actorUserId: user.userId,
        action: "CREATED",
        beforeSnapshot: null,
        afterSnapshot: snapshot(full),
        correlationId,
      },
    });
    return toEventResponse(full, user, tx);
  });
};

const listEvents = async (query, user) => {
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

  const rows = await prisma.event.findMany({
    where,
    include: eventInclude,
    orderBy: [{ startsAt: "asc" }, { eventId: "asc" }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const events = hasMore ? rows.slice(0, query.limit) : rows;
  const last = events.at(-1);
  return {
    events: await Promise.all(events.map((event) => toEventResponse(event, user))),
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

const listActiveEvents = (user) => listEvents({
  statuses: ["PUBLISHED", "IN_PROGRESS"],
  limit: 100,
}, user);

const getEvent = async (eventId, user) => toEventResponse(await requireEvent(eventId, user), user);

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

const updateEvent = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
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
  assertRange(combined, desiredShifts);

return prisma.$transaction(async (tx) => {
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
  const templatesByType = await loadTemplatesByStationType(tx);
  const existingStations = await tx.station.findMany({ where: { eventId } });
  for (const station of existingStations) {
    const template = templatesByType.get(station.stationType);
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
            capacity: templatesByType.get(station.stationType)?.defaultCapacity || current.capacity,
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
      ipAddress: "::1",
    },
  });
  await auditUpdate(tx, current, updated, user, correlationId);

  return toEventResponse(updated, user, tx);
});
};

const transitionEvent = async (eventId, command, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  const transition = ACTIONS[command];
  if (!transition || current.status !== transition.from) {
    throw new AppError(409, "INVALID_EVENT_TRANSITION", "Event cannot perform that transition from its current state");
  }
  return prisma.$transaction(async (tx) => {
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
        ipAddress: "::1",
        deviceName: "Server",
      },
    });
    await tx.eventAuditLog.create({
      data: {
        eventId,
        actorUserId: user.userId,
        action: transition.audit,
        beforeSnapshot: snapshot(current),
        afterSnapshot: snapshot(updated),
        correlationId,
      },
    });

    return toEventResponse(updated, user, tx);
  });
};

const cancelEvent = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);

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
  return prisma.$transaction(async (tx) => {
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
        ipAddress: "::1",
        deviceName: "Server",
      },
    });
    await tx.eventAuditLog.create({
      data: {
        eventId,
        actorUserId: user.userId,
        action: "CANCELLED",
        beforeSnapshot: snapshot(current),
        afterSnapshot: snapshot(updated),
        correlationId,
      },
    });

    return toEventResponse(updated, user, tx);
  });
};

const assertNoCrossEventReferences = async (tx, eventId) => {
  const [registrations, stations, reviews, consents] = await Promise.all([
    tx.eventRegistration.findMany({ where: { eventId }, select: { registrationId: true } }),
    tx.station.findMany({ where: { eventId }, select: { stationId: true } }),
    tx.review.findMany({ where: { registration: { eventId } }, select: { reviewId: true } }),
    tx.participantConsent.findMany({ where: { eventId }, select: { id: true } }),
  ]);
  const registrationIds = registrations.map(({ registrationId }) => registrationId);
  const stationIds = stations.map(({ stationId }) => stationId);
  const reviewIds = reviews.map(({ reviewId }) => reviewId);
  const consentIds = consents.map(({ id }) => id);

  const checks = [];
  if (reviewIds.length) checks.push(tx.review.findFirst({
    where: { OR: [
      { reviewId: { in: reviewIds }, parentReviewId: { not: null, notIn: reviewIds } },
      { reviewId: { notIn: reviewIds }, parentReviewId: { in: reviewIds } },
    ] },
    select: { reviewId: true },
  }));
  if (consentIds.length) checks.push(tx.participantConsent.findFirst({
    where: { OR: [
      { id: { in: consentIds }, withdrawalOfId: { not: null, notIn: consentIds } },
      { id: { notIn: consentIds }, withdrawalOfId: { in: consentIds } },
    ] },
    select: { id: true },
  }));
  if (registrationIds.length || stationIds.length) {
    const outsideRegistrations = registrationIds.length ? { notIn: registrationIds } : { not: null };
    const outsideStations = stationIds.length ? { notIn: stationIds } : { not: null };
    checks.push(tx.queueEntry.findFirst({
      where: { OR: [
        ...(registrationIds.length ? [{ registrationId: { in: registrationIds }, stationId: outsideStations }] : []),
        ...(stationIds.length ? [{ stationId: { in: stationIds }, registrationId: outsideRegistrations }] : []),
      ] },
      select: { id: true },
    }));
    checks.push(tx.queueMovement.findFirst({
      where: { OR: [
        ...(registrationIds.length ? [{ registrationId: { in: registrationIds }, OR: [{ fromStationId: outsideStations }, { toStationId: outsideStations }] }] : []),
        ...(stationIds.length ? [{ registrationId: outsideRegistrations, OR: [{ fromStationId: { in: stationIds } }, { toStationId: { in: stationIds } }] }] : []),
      ] },
      select: { id: true },
    }));
    checks.push(tx.screeningResult.findFirst({
      where: { OR: [
        ...(registrationIds.length ? [{ registrationId: { in: registrationIds }, stationId: outsideStations }] : []),
        ...(stationIds.length ? [{ stationId: { in: stationIds }, registrationId: outsideRegistrations }] : []),
      ] },
      select: { resultId: true },
    }));
  }

  if ((await Promise.all(checks)).some(Boolean)) {
    throw new AppError(409, "EVENT_DELETE_INTEGRITY_CONFLICT", "This event has cross-event records and cannot be deleted safely");
  }
};

const deleteEvent = async (eventId, body, user, correlationId) => {
  if (user.systemRole !== "ADMIN" || !user.roles?.includes("ADMINISTRATOR")) {
    throw new AppError(403, "FORBIDDEN", "Only an administrator can permanently delete an event");
  }
  const current = await requireEvent(eventId, user, true);
  if (!['COMPLETED', 'CANCELLED'].includes(current.status)) {
    throw new AppError(409, "EVENT_NOT_TERMINAL", "Only completed or cancelled events can be permanently deleted");
  }
  if (body.confirmationName !== current.name) {
    throw new AppError(422, "EVENT_DELETE_CONFIRMATION_MISMATCH", "Type the event name exactly to confirm permanent deletion");
  }

  const deletion = await prisma.$transaction(async (tx) => {
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

    await tx.participantConsent.updateMany({ where: { eventId, withdrawalOfId: { not: null } }, data: { withdrawalOfId: null } });
    await tx.participantConsent.deleteMany({ where: { eventId } });
    await tx.signatureArtifact.deleteMany({ where: { eventId } });
    await tx.registrationStatusHistory.deleteMany({ where: { registration: { eventId } } });
    await tx.screeningResult.deleteMany({ where: { registration: { eventId } } });
    await tx.scanLog.deleteMany({ where: { OR: [{ registration: { eventId } }, { station: { eventId } }] } });
    await tx.qRCodePass.deleteMany({ where: { registration: { eventId } } });
    await tx.queueMovement.deleteMany({ where: { registration: { eventId } } });
    await tx.queueEntry.deleteMany({ where: { registration: { eventId } } });
    await tx.eventRegistration.deleteMany({ where: { eventId } });

    // Participants are shared records. Remove only their temporary onboarding
    // scope before deleting the event; the FK also uses SET NULL defensively.
    await tx.participant.updateMany({ where: { onboardingEventId: eventId }, data: { onboardingEventId: null } });

    await tx.staffAssignment.deleteMany({ where: { eventId } });
    await tx.shift.deleteMany({ where: { eventId } });
    await tx.eventStationAvailability.deleteMany({ where: { eventDay: { eventId } } });
    await tx.eventDay.deleteMany({ where: { eventId } });
    await tx.station.deleteMany({ where: { eventId } });

    // Event audit rows are immutable at the database layer. The only deletion
    // escape hatch is transaction-local and scoped to this already validated,
    // terminal event; the trigger rejects every UPDATE and every other DELETE.
    await tx.$queryRawUnsafe(
      "SELECT set_config('vsms.event_audit_delete_event_id', $1, true)",
      eventId,
    );
    await tx.eventAuditLog.deleteMany({ where: { eventId } });
    await tx.$queryRawUnsafe(
      "SELECT set_config('vsms.event_audit_delete_event_id', '', true)",
    );

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
        requestId: correlationId,
        details: { status: current.status, version: body.version },
        ipAddress: "::1",
        deviceName: "Server",
      },
    });
    return { result: { eventId, deleted: true }, cleanupTaskCount };
  });

  if (deletion.cleanupTaskCount > 0) {
    await processArtifactCleanupTasks({ eventId }).catch((error) => {
      // Durable tasks remain retryable; never expose a storage path in logs.
      console.error("Post-delete artifact cleanup deferred", { eventId, code: error?.code || "ARTIFACT_CLEANUP_FAILED" });
    });
  }
  return deletion.result;
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
// Import/update map templateKey → StationType per #30 (catalog keys include
// REGISTRATION / CLINICAL_REVIEW which are not StationType and are rejected on import).
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
  return templates.filter((template) => stationTypeForTemplateKey(template.templateKey));
};

const importStations = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  assertStationPlanningState(current);

  const templates = await prisma.stationTemplate.findMany({
    where: { stationTemplateId: { in: body.stationTemplateIds }, active: true },
  });
  if (templates.length !== body.stationTemplateIds.length) {
    throw new AppError(422, "STATION_TEMPLATE_NOT_AVAILABLE", "One or more station templates are unavailable");
  }

  const orderedTemplates = body.stationTemplateIds.map((id) => templates.find((template) => template.stationTemplateId === id));
  const { importable, skipped } = classifyTemplates(orderedTemplates);
  if (skipped.length > 0) {
    const keys = skipped.map((template) => template.templateKey).join(", ");
    throw new AppError(
      422,
      "STATION_TEMPLATE_NOT_IMPORTABLE",
      `These templates are not screening stations and cannot be imported: ${keys}`,
    );
  }

  const existingStations = current.stations || [];
  const existingTypes = new Set(existingStations.map((station) => station.stationType));
  const newTypes = importable.filter(({ stationType }) => !existingTypes.has(stationType));
  if (existingStations.length + newTypes.length > 50) {
    throw new AppError(422, "STATION_LIMIT_EXCEEDED", "An event can have at most 50 stations");
  }

  return prisma.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);

    let nextOrder = existingStations.reduce((max, station) => Math.max(max, station.stationOrder), 0);
    for (const { template, stationType } of importable) {
      const existing = existingStations.find((station) => station.stationType === stationType);
      if (existing) {
        await tx.station.update({
          where: { stationId: existing.stationId },
          data: {
            stationName: template.name,
            isActive: true,
          },
        });
      } else {
        nextOrder += 1;
        const created = await tx.station.create({
          data: {
            eventId,
            stationType,
            stationName: template.name,
            stationOrder: nextOrder,
            isActive: true,
          },
        });
        existingStations.push(created);
      }
    }

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user, tx);
  });
};

const updateStation = async (eventId, eventStationId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  assertStationPlanningState(current);
  const stations = current.stations || [];
  const station = stations.find((candidate) => candidate.stationId === eventStationId);
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Event station was not found");
  if (body.stationOrder !== undefined && body.stationOrder > stations.length) {
    throw new AppError(422, "INVALID_STATION_ORDER", "Station order must be within the event station list");
  }

  return prisma.$transaction(async (tx) => {
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

    // body.capacity accepted for OpenAPI/UI compatibility; Station has no capacity column (#30 MVP).
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user, tx);
  });
};

const addStaffAssignment = async (eventId, shiftId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
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

  return prisma.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);
    await lockStaffSchedules(tx, [body.userId]);

    const activeUser = await tx.user.findFirst({
      where: { id: body.userId, status: "ACTIVE" },
      select: { id: true, userRoles: { select: { role: { select: { roleName: true } } } } },
    });
    if (!activeUser) throw new AppError(422, "STAFF_NOT_AVAILABLE", "The selected staff member is unavailable");
    const applicationRoles = new Set(activeUser.userRoles.map(({ role }) => role.roleName));
    if (applicationRoles.has("ADMINISTRATOR") || !applicationRoles.has(ASSIGNMENT_APPLICATION_ROLES[body.assignmentRole])) {
      throw new AppError(422, "STAFF_ROLE_MISMATCH", "The selected staff member does not hold the required account role");
    }

    const conflict = await tx.staffAssignment.findFirst({
      where: {
        userId: body.userId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        shift: { startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } },
      },
      select: { id: true },
    });
    if (conflict) throw scheduleConflictError();

    await tx.staffAssignment.create({
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

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user, tx);
  });
};

const removeStaffAssignment = async (eventId, shiftId, assignmentId, version, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status)) {
    throw new AppError(409, "STAFFING_NOT_EDITABLE", "Staffing cannot be changed for a completed or cancelled event");
  }
  const assignment = current.shifts
    .find((shift) => shift.shiftId === shiftId)
    ?.staffAssignments.find((candidate) => candidate.id === assignmentId);
  if (!assignment) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Staff assignment was not found");

  return prisma.$transaction(async (tx) => {
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
    return toEventResponse(updated, user, tx);
  });
};

const getAuditLog = async (eventId, query, user) => {
  await requireEvent(eventId, user, true);
  const scope = `event-audit:${eventId}:${query.limit}`;
  const cursor = decodeCursor(query.cursor, scope);

  const rows = await prisma.eventAuditLog.findMany({
    where: {
      eventId,
      ...(cursor
        ? {
            createdAt: { lt: new Date(cursor.createdAt) },
          }
        : {}),
    },
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

module.exports = {
  createEvent,
  listEvents,
  listActiveEvents,
  getEvent,
  updateEvent,
  transitionEvent,
  cancelEvent,
  deleteEvent,
  listStaffDirectory,
  listStationTemplates,
  importStations,
  updateStation,
  addStaffAssignment,
  removeStaffAssignment,
  getAuditLog,
};
