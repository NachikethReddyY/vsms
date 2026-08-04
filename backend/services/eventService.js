const prisma = require("../prisma/prismaClient");
const crypto = require("crypto");
const AppError = require("../errors/AppError");
const { encodeCursor, decodeCursor } = require("../utils/cursor");
const env = require("../config/env");
const { createExportReceipt, verifyExportReceipt } = require("../utils/eventExportReceipt");
const {
  classifyTemplates,
  stationTypeForTemplateKey,
} = require("./stationTemplateMapping");

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
      eventStationId: assignment.eventStation?.eventStationId
        || assignment.station?.stationId
        || assignment.stationId
        || null,
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
    where: { registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] } },
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

const loadTemplatesByStationType = async (db = prisma) => {
  if (!db.stationTemplate?.findMany) return new Map();
  const templates = await db.stationTemplate.findMany({ where: { active: true } });
  const byType = new Map();
  for (const template of templates) {
    const stationType = stationTypeForTemplateKey(template.templateKey);
    if (stationType) byType.set(stationType, template);
  }
  return byType;
};

const loadAvailabilitiesByStationId = async (stations, db = prisma) => {
  const byStationId = new Map();
  if (stations.length === 0 || !db.eventStationAvailability?.findMany) return byStationId;
  const rows = await db.eventStationAvailability.findMany({
    where: { eventStationId: { in: stations.map((station) => station.stationId) } },
    include: { eventDay: { select: { eventDayId: true, date: true } } },
    orderBy: { eventDay: { date: "asc" } },
  });
  for (const row of rows) {
    const availability = {
      eventStationAvailabilityId: row.eventStationAvailabilityId,
      isAvailable: row.isAvailable,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      capacity: row.capacity,
      eventDay: {
        eventDayId: row.eventDay.eventDayId,
        date: row.eventDay.date instanceof Date
          ? row.eventDay.date.toISOString().slice(0, 10)
          : String(row.eventDay.date).slice(0, 10),
      },
    };
    byStationId.set(row.eventStationId, [...(byStationId.get(row.eventStationId) || []), availability]);
  }
  return byStationId;
};

const mapStationDto = (station, event, templatesByType, availabilitiesByStationId) => {
  const template = templatesByType.get(station.stationType);
  const availabilities = availabilitiesByStationId.get(station.stationId) || [];
  return {
    eventStationId: station.stationId,
    // OpenAPI EventStation DTO: id is Station.stationId; template id resolved via #30 mapping.
    stationTemplateId: template?.stationTemplateId || station.stationId,
    templateVersion: template?.version || 1,
    name: station.stationName,
    description: template?.description || station.stationType,
    stationOrder: station.stationOrder,
    capacity: availabilities[0]?.capacity || template?.defaultCapacity || event.capacity,
    isAvailable: station.isActive,
    availabilities,
  };
};

const toEventResponse = async ({ _count = {}, registrations = [], stations = [], ...event }, user, db = prisma) => {
  const manageable = user ? canManage(event, user) : false;
  const [templatesByType, availabilitiesByStationId] = await Promise.all([
    loadTemplatesByStationType(db),
    loadAvailabilitiesByStationId(stations, db),
  ]);
  const shifts = (event.shifts || []).map((shift) => ({
    ...shift,
    staffAssignments: (shift.staffAssignments || []).map(({ assignedUser, station, notes, ...assignment }) => {
      const template = station ? templatesByType.get(station.stationType) : null;
      return {
        ...assignment,
        ...(manageable ? { notes } : {}),
        staffAssignmentId: assignment.id,
        user: publicUser(assignedUser),
        eventStation: station ? {
          eventStationId: station.stationId,
          stationTemplateId: template?.stationTemplateId || station.stationId,
          name: station.stationName,
          stationOrder: station.stationOrder,
        } : null,
      };
    }),
  }));
  const eventStations = stations.map((station) => mapStationDto(
    station,
    event,
    templatesByType,
    availabilitiesByStationId,
  ));
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

const auditUpdate = (tx, current, updated, user, context) => tx.auditLog.create({
  data: {
    userId: user.userId,
    action: "UPDATED",
    entityName: "Event",
    entityId: current.eventId,
    ...auditFields(context),
    oldValue: snapshot(current),
    newValue: snapshot(updated),
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
    where: { id: { in: [...new Set(schedules.map(({ userId }) => userId))] }, status: "ACTIVE" },
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
  if (!stations?.length) return stationsByTemplate;
  const existing = await tx.station.findMany({ where: { eventId }, orderBy: { stationOrder: "asc" } });
  const planned = stations.map((input) => {
    const template = templatesById.get(input.stationTemplateId);
    const stationType = stationTypeForTemplateKey(template.templateKey);
    if (!stationType) {
      throw new AppError(
        422,
        "STATION_TEMPLATE_NOT_IMPORTABLE",
        `${template.templateKey} cannot be imported as a Station (not a screening StationType)`,
      );
    }
    return { input, template, stationType };
  });
  const plannedTypes = new Set(planned.map(({ stationType }) => stationType));
  const untouchedOrders = new Set(existing
    .filter((station) => !plannedTypes.has(station.stationType))
    .map((station) => station.stationOrder));
  if (planned.some(({ input }) => untouchedOrders.has(input.stationOrder))) {
    throw new AppError(422, "INVALID_STATION_ORDER", "Station order conflicts with an existing event station");
  }
  let temporaryOrder = existing.reduce((max, station) => Math.max(max, station.stationOrder), 0);
  for (const station of existing.filter((row) => plannedTypes.has(row.stationType))) {
    temporaryOrder += 1;
    await tx.station.update({ where: { stationId: station.stationId }, data: { stationOrder: temporaryOrder } });
    station.stationOrder = temporaryOrder;
  }

  for (const { input, template, stationType } of planned) {
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
      station = await tx.station.create({
        data: {
          eventId,
          stationType,
          stationName: template.name,
          stationOrder: input.stationOrder,
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
  const inputsWithAssignments = (shiftInputs || []).filter((shift) => shift.assignments !== undefined);
  if (inputsWithAssignments.length === 0) return;
  await assertAssignmentSchedulesAvailable(tx, eventId, inputsWithAssignments);
  const savedShifts = await tx.shift.findMany({ where: { eventId } });
  for (const input of inputsWithAssignments) {
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

const createEvent = async (body, user, context, rawIdempotencyKey, db = prisma) => {
  if (!["ADMIN", "EVENT_MANAGER"].includes(user.systemRole)) {
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
        return toEventResponse(replay, user, tx);
      }
    }
    const eventData = normalizeEventData(body);
    assertRange(eventData, body.shifts || [], body.eventDays || []);
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
        ...auditFields(context),
        newValue: snapshot(full),
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
    events: await Promise.all(events.map((event) => toEventResponse(event, user, db))),
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
  DRAFT: editableEventKeys,
  PUBLISHED: editableEventKeys,
  IN_PROGRESS: new Set([
    "description",
    "bannerKey",
    "artworkDataUrl",
    "capacity",
  ]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

const updateEvent = async (eventId, body, user, context, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
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

  const stationInputs = body.stations?.length ? body.stations : null;
  const hasAssignmentChanges = (body.shifts || []).some((shift) => shift.assignments !== undefined);
  const needsStationPlanning = Boolean(body.eventDays || stationInputs || hasAssignmentChanges);
  let daysByDate = new Map();
  if (body.eventDays) {
    await tx.eventStationAvailability.deleteMany({ where: { eventDay: { eventId } } });
    await tx.eventDay.deleteMany({ where: { eventId } });
    daysByDate = await createEventDays(tx, eventId, body.eventDays);
  } else if (needsStationPlanning) {
    const days = await tx.eventDay.findMany({ where: { eventId } });
    daysByDate = new Map(days.map((day) => [day.date.toISOString().slice(0, 10), day]));
  }

  let stationsByTemplate = new Map();
  if (needsStationPlanning) {
    const templatesByType = await loadTemplatesByStationType(tx);
    const existingStations = await tx.station.findMany({ where: { eventId } });
    for (const station of existingStations) {
      const template = templatesByType.get(station.stationType);
      if (template) stationsByTemplate.set(template.stationTemplateId, station);
    }

    if (stationInputs) {
      const templatesById = await requireTemplates(tx, stationInputs);
      stationsByTemplate = await createEventStations(tx, eventId, stationInputs, daysByDate, templatesById);
    } else if (body.eventDays) {
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
      entityName: "Event",
      entityId: eventId,
      ...auditFields(context),
      oldValue: snapshot(current),
      newValue: snapshot(updated),
    },
  });

  return toEventResponse(updated, user, tx);
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

    return toEventResponse(updated, user, tx);
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

    return toEventResponse(updated, user, tx);
  });
};

const listStaffDirectory = async (db = prisma) => {
  const users = await db.user.findMany({
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
// Import/update map templateKey → StationType per #30 (catalog keys include
// REGISTRATION / CLINICAL_REVIEW which are not StationType and are rejected on import).
const listStationTemplates = async (db = prisma) => {
  const templates = await db.stationTemplate.findMany({
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

const importStations = async (eventId, body, user, context, db = prisma) => {
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

  return db.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);

    let nextOrder = existingStations.reduce((max, station) => Math.max(max, station.stationOrder), 0);
    for (const { template, stationType } of importable) {
      const existing = existingStations.find((station) => station.stationType === stationType);
      let station;
      if (existing) {
        station = await tx.station.update({
          where: { stationId: existing.stationId },
          data: {
            stationName: template.name,
            isActive: true,
          },
        });
      } else {
        nextOrder += 1;
        station = await tx.station.create({
          data: {
            eventId,
            stationType,
            stationName: template.name,
            stationOrder: nextOrder,
            isActive: true,
          },
        });
        existingStations.push(station);
      }

      const availabilityCount = await tx.eventStationAvailability.count({
        where: { eventStationId: station.stationId },
      });
      if (availabilityCount === 0 && current.eventDays.length > 0) {
        await tx.eventStationAvailability.createMany({
          data: current.eventDays.map((day) => ({
            eventStationId: station.stationId,
            eventDayId: day.eventDayId,
            isAvailable: true,
            startsAt: day.startsAt,
            endsAt: day.endsAt,
            capacity: template.defaultCapacity,
          })),
        });
      }
    }

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, context);
    return toEventResponse(updated, user, tx);
  });
};

const updateStation = async (eventId, eventStationId, body, user, context, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  assertStationPlanningState(current);
  const stations = current.stations || [];
  const station = stations.find((candidate) => candidate.stationId === eventStationId);
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Event station was not found");
  if (body.stationOrder !== undefined && body.stationOrder > stations.length) {
    throw new AppError(422, "INVALID_STATION_ORDER", "Station order must be within the event station list");
  }
  if (body.capacity !== undefined && current.eventDays.length === 0) {
    throw new AppError(422, "STATION_CAPACITY_REQUIRES_EVENT_DAY", "Add an event day before setting station capacity");
  }

  return db.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);

    if (body.stationOrder !== undefined && body.stationOrder !== station.stationOrder) {
      const displaced = stations.find((candidate) => candidate.stationOrder === body.stationOrder);
      if (!displaced) throw new AppError(422, "INVALID_STATION_ORDER", "Station order must be within the event station list");
      const tempOrder = Math.max(...stations.map((candidate) => candidate.stationOrder)) + 1;
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

    if (body.capacity !== undefined) {
      const changed = await tx.eventStationAvailability.updateMany({
        where: { eventStationId },
        data: { capacity: body.capacity },
      });
      if (changed.count === 0 && current.eventDays.length > 0) {
        await tx.eventStationAvailability.createMany({
          data: current.eventDays.map((day) => ({
            eventStationId,
            eventDayId: day.eventDayId,
            isAvailable: body.isAvailable ?? station.isActive,
            startsAt: (body.isAvailable ?? station.isActive) ? day.startsAt : null,
            endsAt: (body.isAvailable ?? station.isActive) ? day.endsAt : null,
            capacity: body.capacity,
          })),
        });
      }
    }

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, context);
    return toEventResponse(updated, user, tx);
  });
};

const addStaffAssignment = async (eventId, shiftId, body, user, context, db = prisma) => {
  const current = await requireEvent(eventId, user, true, db);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status)) {
    throw new AppError(409, "STAFFING_NOT_EDITABLE", "Staffing cannot be changed for a completed or cancelled event");
  }

  const shift = current.shifts.find((candidate) => candidate.shiftId === shiftId);
  if (!shift) throw new AppError(404, "SHIFT_NOT_FOUND", "Event shift was not found");

  const station = body.eventStationId
    ? current.stations.find((candidate) => candidate.stationId === body.eventStationId && candidate.isActive)
    : null;
  if (body.eventStationId && !station) {
    throw new AppError(422, "STATION_NOT_AVAILABLE", "The selected event station is unavailable");
  }
  if (body.assignmentRole === "SCREENER" && !station) {
    throw new AppError(422, "STATION_REQUIRED", "Screeners must be assigned to an event station");
  }

  return db.$transaction(async (tx) => {
    await lockStaffSchedules(tx, [body.userId]);

    const activeUser = await tx.user.findFirst({
      where: { id: body.userId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!activeUser) throw new AppError(422, "STAFF_NOT_AVAILABLE", "The selected staff member is unavailable");

    const conflict = await tx.staffAssignment.findFirst({
      where: {
        userId: body.userId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        shift: {
          startsAt: { lt: shift.endsAt },
          endsAt: { gt: shift.startsAt },
        },
      },
      select: { id: true },
    });
    if (conflict) throw scheduleConflictError();

    await bumpEventVersion(tx, eventId, body.version);
    await tx.staffAssignment.create({
      data: {
        eventId,
        shiftId,
        userId: body.userId,
        stationId: station?.stationId || null,
        assignedBy: user.userId,
        assignmentRole: body.assignmentRole,
        assignmentStatus: "ASSIGNED",
        status: "ASSIGNED",
        notes: body.notes || null,
      },
    });

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: "STAFF_ASSIGNMENT_ADDED",
        entityName: "Event",
        entityId: eventId,
        ...auditFields(context),
        oldValue: snapshot(current),
        newValue: snapshot(updated),
      },
    });
    return toEventResponse(updated, user, tx);
  });
};

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

    return toEventResponse(updated, user, tx);
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
