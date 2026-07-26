const prisma = require("../prisma/prismaClient");
const crypto = require("crypto");
const AppError = require("../errors/AppError");
const { encodeCursor, decodeCursor } = require("../utils/cursor");

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
  eventStations: (event.eventStations || []).map((station) => ({
    eventStationId: station.eventStationId,
    stationTemplateId: station.stationTemplateId,
    templateVersion: station.templateVersion,
    name: station.name,
    stationOrder: station.stationOrder,
    capacity: station.capacity,
    isAvailable: station.isAvailable,
  })),
  shifts: (event.shifts || []).map((shift) => ({
    shiftId: shift.shiftId,
    name: shift.name,
    startsAt: shift.startsAt instanceof Date ? shift.startsAt.toISOString() : shift.startsAt,
    endsAt: shift.endsAt instanceof Date ? shift.endsAt.toISOString() : shift.endsAt,
    requiredStaff: shift.requiredStaff,
    status: shift.status,
      staffAssignments: (shift.staffAssignments || []).map((assignment) => ({
      staffAssignmentId: assignment.staffAssignmentId,
      userId: assignment.user?.userId,
      assignmentRole: assignment.assignmentRole,
      eventStationId: assignment.eventStation?.eventStationId || null,
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
  eventStations: {
    orderBy: { stationOrder: "asc" },
    select: {
      eventStationId: true,
      stationTemplateId: true,
      templateVersion: true,
      name: true,
      description: true,
      stationOrder: true,
      capacity: true,
      isAvailable: true,
      availabilities: {
        orderBy: { eventDay: { date: "asc" } },
        select: {
          eventStationAvailabilityId: true,
          isAvailable: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          eventDay: { select: { eventDayId: true, date: true } },
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

const toEventResponse = ({ _count, registrations, ...event }, user) => ({
  ...event,
  eventDays: (event.eventDays || []).map((day) => ({
    ...day,
    date: day.date instanceof Date ? day.date.toISOString().slice(0, 10) : String(day.date).slice(0, 10),
  })),
  eventStations: (event.eventStations || []).map((station) => ({
    ...station,
    availabilities: (station.availabilities || []).map((availability) => ({
      ...availability,
      eventDay: {
        ...availability.eventDay,
        date: availability.eventDay.date instanceof Date
          ? availability.eventDay.date.toISOString().slice(0, 10)
          : String(availability.eventDay.date).slice(0, 10),
      },
    })),
  })),
  signupCount: _count.registrations,
  activeCapacityCount: registrations.length,
  canManage: canManage(event, user),
});

const visibilityWhere = (user) => {
  if (user.systemRole === "ADMIN") return {};
  const assigned = {
    shifts: {
      some: {
        staffAssignments: {
          some: { userId: user.userId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        },
      },
    },
  };
  return user.systemRole === "EVENT_MANAGER"
    ? { OR: [{ createdByUserId: user.userId }, assigned] }
    : assigned;
};

const loadEventWithAssignment = (eventId, user) => prisma.event.findFirst({
  where: { eventId, ...visibilityWhere(user) },
  include: eventInclude,
});

const canManage = (event, user) => user.systemRole === "ADMIN"
  || (user.systemRole === "EVENT_MANAGER" && (
    event.createdByUserId === user.userId
    || event.shifts.some((shift) => shift.staffAssignments.some((assignment) => (
      assignment.user.userId === user.userId
      && assignment.assignmentRole === "EVENT_MANAGER"
      && ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
    )))
  ));

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
  for (const userId of [...new Set(userIds)].sort()) {
    await tx.$queryRaw`SELECT "user_id" FROM "users" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
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
        userId: assignment.user.userId,
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
        shifts: { create: body.shifts.map((shift) => ({ ...normalizeShift(shift), eventId: undefined })) },
      },
    });
    const daysByDate = await createEventDays(tx, created.eventId, body.eventDays);
    const stationsByTemplate = await createEventStations(tx, created.eventId, body.stations, daysByDate, templatesById);
    await createShiftAssignments(tx, created.eventId, body.shifts, stationsByTemplate, user.userId);
    const event = await tx.event.findUniqueOrThrow({ where: { eventId: created.eventId }, include: eventInclude });
    await tx.eventAuditLog.create({
      data: { eventId: event.eventId, actorUserId: user.userId, action: "CREATED", afterSnapshot: snapshot(event), correlationId },
    });
    return toEventResponse(event, user);
  });
};

const listEvents = async (query, user) => {
  const scope = `events:${query.status || "all"}:${query.search || ""}:${query.limit}`;
  const cursor = decodeCursor(query.cursor, scope);
  const where = { AND: [
    visibilityWhere(user),
    ...(query.status ? [{ status: query.status }] : []),
    ...(query.search ? [{ OR: [
      { name: { contains: query.search, mode: "insensitive" } },
      { venue: { contains: query.search, mode: "insensitive" } },
    ] }] : []),
    ...(cursor ? [{ OR: [
      { startsAt: { gt: new Date(cursor.startsAt) } },
      { startsAt: new Date(cursor.startsAt), eventId: { gt: cursor.eventId } },
    ] }] : []),
  ] };
  const rows = await prisma.event.findMany({ where, include: eventListInclude, orderBy: [{ startsAt: "asc" }, { eventId: "asc" }], take: query.limit + 1 });
  const hasMore = rows.length > query.limit;
  const events = hasMore ? rows.slice(0, query.limit) : rows;
  const last = events.at(-1);
  return {
    events: events.map((event) => toEventResponse(event, user)),
    nextCursor: hasMore && last ? encodeCursor({ scope, startsAt: last.startsAt.toISOString(), eventId: last.eventId }) : null,
  };
};

const getEvent = async (eventId, user) => toEventResponse(await requireEvent(eventId, user), user);

const editableEventKeys = new Set([
  "name", "description", "bannerKey", "artworkDataUrl", "venue", "address", "postalCode",
  "latitude", "longitude", "locationProvider", "locationReference", "timezone", "startsAt",
  "endsAt", "capacity", "expectedAttendance", "eventDays", "stations", "shifts",
]);
const allowedUpdateKeys = {
  DRAFT: editableEventKeys,
  PUBLISHED: editableEventKeys,
  IN_PROGRESS: editableEventKeys,
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

const updateEvent = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  const suppliedKeys = Object.keys(body).filter((key) => !["version"].includes(key));
  if (suppliedKeys.some((key) => !allowedUpdateKeys[current.status].has(key))) {
    throw new AppError(409, "EVENT_NOT_EDITABLE", "One or more fields cannot be changed in the current event state");
  }
  if (current.status === "IN_PROGRESS" && body.capacity !== undefined && body.capacity < current.capacity) {
    throw new AppError(409, "CAPACITY_CANNOT_DECREASE", "Capacity cannot decrease after an event starts");
  }

  const combined = { ...current, ...normalizeEventData(body) };
  const desiredShifts = body.shifts || current.shifts;
  assertRange(combined, desiredShifts);

  return prisma.$transaction(async (tx) => {
    const changed = await tx.event.updateMany({
      where: { eventId, version: body.version },
      data: { ...normalizeEventData(body), version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
    let daysByDate;
    if (body.eventDays) {
      await tx.eventStationAvailability.deleteMany({ where: { eventDay: { eventId } } });
      await tx.eventDay.deleteMany({ where: { eventId } });
      daysByDate = await createEventDays(tx, eventId, body.eventDays);
    } else {
      const days = await tx.eventDay.findMany({ where: { eventId } });
      daysByDate = new Map(days.map((day) => [day.date.toISOString().slice(0, 10), day]));
    }

    let stationsByTemplate;
    if (body.stations) {
      const templatesById = await requireTemplates(tx, body.stations);
      const currentStations = await tx.eventStation.findMany({ where: { eventId } });
      const currentByTemplate = new Map(currentStations.map((station) => [station.stationTemplateId, station]));
      const desiredTemplateIds = body.stations.map((station) => station.stationTemplateId);
      for (const input of body.stations) {
        if (input.eventStationId) {
          const owned = currentStations.find((station) => station.eventStationId === input.eventStationId);
          if (!owned || owned.stationTemplateId !== input.stationTemplateId) {
            throw new AppError(422, "INVALID_STATION", "A station does not belong to this event");
          }
        }
      }
      await tx.eventStation.deleteMany({ where: { eventId, stationTemplateId: { notIn: desiredTemplateIds } } });
      for (const [index, station] of currentStations.filter((station) => desiredTemplateIds.includes(station.stationTemplateId)).entries()) {
        await tx.eventStation.update({ where: { eventStationId: station.eventStationId }, data: { stationOrder: 1000 + index } });
      }
      stationsByTemplate = new Map();
      for (const input of body.stations) {
        const template = templatesById.get(input.stationTemplateId);
        const existingStation = currentByTemplate.get(input.stationTemplateId);
        const station = existingStation
          ? await tx.eventStation.update({
            where: { eventStationId: existingStation.eventStationId },
            data: { stationOrder: input.stationOrder, capacity: input.capacity, isAvailable: input.isAvailable },
          })
          : await tx.eventStation.create({
            data: {
              eventId,
              stationTemplateId: input.stationTemplateId,
              templateVersion: template.version,
              name: template.name,
              description: template.description,
              stationOrder: input.stationOrder,
              capacity: input.capacity,
              isAvailable: input.isAvailable,
            },
          });
        stationsByTemplate.set(input.stationTemplateId, station);
        await tx.eventStationAvailability.deleteMany({ where: { eventStationId: station.eventStationId } });
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
    } else {
      const stations = await tx.eventStation.findMany({ where: { eventId } });
      stationsByTemplate = new Map(stations.map((station) => [station.stationTemplateId, station]));
      if (body.eventDays) {
        for (const station of stations) {
          for (const day of daysByDate.values()) {
            await tx.eventStationAvailability.create({
              data: {
                eventStationId: station.eventStationId,
                eventDayId: day.eventDayId,
                isAvailable: station.isAvailable,
                startsAt: station.isAvailable ? day.startsAt : null,
                endsAt: station.isAvailable ? day.endsAt : null,
                capacity: station.capacity,
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

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.eventAuditLog.create({
      data: { eventId, actorUserId: user.userId, action: "UPDATED", beforeSnapshot: snapshot(current), afterSnapshot: snapshot(updated), correlationId },
    });
    return toEventResponse(updated, user);
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
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.eventAuditLog.create({ data: { eventId, actorUserId: user.userId, action: transition.audit, beforeSnapshot: snapshot(current), afterSnapshot: snapshot(updated), correlationId } });
    return toEventResponse(updated, user);
  });
};

const cancelEvent = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status) || (current.status === "IN_PROGRESS" && user.systemRole !== "ADMIN")) {
    throw new AppError(409, "INVALID_EVENT_TRANSITION", "Event cannot be cancelled from its current state");
  }
  return prisma.$transaction(async (tx) => {
    const changed = await tx.event.updateMany({
      where: { eventId, version: body.version, status: current.status },
      data: { status: "CANCELLED", cancellationReason: body.reason, cancelledAt: new Date(), cancelledByUserId: user.userId, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
    await tx.shift.updateMany({ where: { eventId, status: { in: ["PLANNED", "ACTIVE"] } }, data: { status: "CANCELLED" } });
    await tx.staffAssignment.updateMany({ where: { shift: { eventId }, status: { in: ["ASSIGNED", "CONFIRMED"] } }, data: { status: "CANCELLED" } });
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.eventAuditLog.create({ data: { eventId, actorUserId: user.userId, action: "CANCELLED", beforeSnapshot: snapshot(current), afterSnapshot: snapshot(updated), correlationId } });
    return toEventResponse(updated, user);
  });
};

const listStaffDirectory = async () => prisma.user.findMany({
  where: { status: "ACTIVE" },
  select: { userId: true, username: true, systemRole: true },
  orderBy: { username: "asc" },
  take: 200,
});

const listStationTemplates = async () => prisma.stationTemplate.findMany({
  where: { active: true },
  select: {
    stationTemplateId: true,
    templateKey: true,
    version: true,
    name: true,
    description: true,
    defaultCapacity: true,
  },
  orderBy: [{ name: "asc" }, { version: "desc" }],
  take: 200,
});

const importStations = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  assertStationPlanningState(current);
  if (current.eventStations.length + body.stationTemplateIds.length > 50) {
    throw new AppError(422, "STATION_LIMIT_EXCEEDED", "An event can have at most 50 stations");
  }

  const templates = await prisma.stationTemplate.findMany({
    where: { stationTemplateId: { in: body.stationTemplateIds }, active: true },
  });
  if (templates.length !== body.stationTemplateIds.length) {
    throw new AppError(422, "STATION_TEMPLATE_NOT_AVAILABLE", "One or more station templates are unavailable");
  }
  const alreadyImported = current.eventStations.find((station) => body.stationTemplateIds.includes(station.stationTemplateId));
  if (alreadyImported) throw new AppError(409, "STATION_ALREADY_IMPORTED", `${alreadyImported.name} is already part of this event`);

  const byId = new Map(templates.map((template) => [template.stationTemplateId, template]));
  return prisma.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);
    for (const [index, stationTemplateId] of body.stationTemplateIds.entries()) {
      const template = byId.get(stationTemplateId);
      const station = await tx.eventStation.create({
        data: {
          eventId,
          stationTemplateId,
          templateVersion: template.version,
          name: template.name,
          description: template.description,
          stationOrder: current.eventStations.length + index + 1,
          capacity: template.defaultCapacity,
        },
      });
      for (const day of current.eventDays) {
        await tx.eventStationAvailability.create({
          data: {
            eventStationId: station.eventStationId,
            eventDayId: day.eventDayId,
            isAvailable: true,
            startsAt: day.startsAt,
            endsAt: day.endsAt,
            capacity: template.defaultCapacity,
          },
        });
      }
    }
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user);
  });
};

const updateStation = async (eventId, eventStationId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  assertStationPlanningState(current);
  const station = current.eventStations.find((candidate) => candidate.eventStationId === eventStationId);
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Event station was not found");
  if (body.stationOrder !== undefined && body.stationOrder > current.eventStations.length) {
    throw new AppError(422, "INVALID_STATION_ORDER", "Station order must be within the event station list");
  }

  return prisma.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);
    if (body.stationOrder !== undefined && body.stationOrder !== station.stationOrder) {
      const displaced = current.eventStations.find((candidate) => candidate.stationOrder === body.stationOrder);
      if (!displaced) throw new AppError(422, "INVALID_STATION_ORDER", "Station order must be within the event station list");
      await tx.eventStation.update({
        where: { eventStationId: displaced.eventStationId },
        data: { stationOrder: current.eventStations.length + 1 },
      });
      await tx.eventStation.update({
        where: { eventStationId },
        data: { stationOrder: body.stationOrder },
      });
      await tx.eventStation.update({
        where: { eventStationId: displaced.eventStationId },
        data: { stationOrder: station.stationOrder },
      });
    }
    if (body.capacity !== undefined || body.isAvailable !== undefined) {
      await tx.eventStation.update({
        where: { eventStationId },
        data: {
          ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
          ...(body.isAvailable !== undefined ? { isAvailable: body.isAvailable } : {}),
        },
      });
    }
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user);
  });
};

const addStaffAssignment = async (eventId, shiftId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status)) {
    throw new AppError(409, "STAFFING_NOT_EDITABLE", "Staffing cannot be changed for a completed or cancelled event");
  }
  const shift = current.shifts.find((candidate) => candidate.shiftId === shiftId);
  if (!shift) {
    throw new AppError(404, "SHIFT_NOT_FOUND", "Shift was not found");
  }
  if (body.eventStationId) {
    const station = current.eventStations.find((candidate) => candidate.eventStationId === body.eventStationId);
    if (!station || !station.isAvailable) {
      throw new AppError(422, "STATION_NOT_AVAILABLE", "The selected event station is unavailable");
    }
  }

  return prisma.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, body.version);
    await lockStaffSchedules(tx, [body.userId]);
    const target = await tx.user.findFirst({ where: { userId: body.userId, status: "ACTIVE" }, select: { userId: true } });
    if (!target) throw new AppError(422, "STAFF_NOT_AVAILABLE", "The selected staff member is not available");
    const existing = await tx.staffAssignment.findUnique({
      where: { shiftId_userId: { shiftId, userId: body.userId } },
    });
    const conflict = await tx.staffAssignment.findFirst({
      where: {
        userId: body.userId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        ...(existing ? { staffAssignmentId: { not: existing.staffAssignmentId } } : {}),
        shift: {
          startsAt: { lt: shift.endsAt },
          endsAt: { gt: shift.startsAt },
        },
      },
      select: { staffAssignmentId: true },
    });
    if (conflict) throw scheduleConflictError();

    const data = {
      assignmentRole: body.assignmentRole,
      eventStationId: body.eventStationId || null,
      status: "ASSIGNED",
      assignedByUserId: user.userId,
      notes: body.notes || null,
    };
    if (existing) {
      await tx.staffAssignment.update({ where: { staffAssignmentId: existing.staffAssignmentId }, data });
    } else {
      await tx.staffAssignment.create({
        data: { ...data, shiftId, userId: body.userId },
      });
    }
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user);
  });
};

const removeStaffAssignment = async (eventId, shiftId, assignmentId, version, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(current.status)) {
    throw new AppError(409, "STAFFING_NOT_EDITABLE", "Staffing cannot be changed for a completed or cancelled event");
  }
  const assignment = current.shifts
    .find((shift) => shift.shiftId === shiftId)
    ?.staffAssignments.find((candidate) => candidate.staffAssignmentId === assignmentId);
  if (!assignment) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Staff assignment was not found");

  return prisma.$transaction(async (tx) => {
    await bumpEventVersion(tx, eventId, version);
    await tx.staffAssignment.delete({ where: { staffAssignmentId: assignmentId } });
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await auditUpdate(tx, current, updated, user, correlationId);
    return toEventResponse(updated, user);
  });
};

const getAuditLog = async (eventId, query, user) => {
  await requireEvent(eventId, user, true);
  const scope = `event-audit:${eventId}:${query.limit}`;
  const cursor = decodeCursor(query.cursor, scope);
  const rows = await prisma.eventAuditLog.findMany({
    where: {
      eventId,
      ...(cursor ? { OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), eventAuditLogId: { lt: cursor.eventAuditLogId } },
      ] } : {}),
    },
    include: { actor: { select: { userId: true, username: true, email: true, systemRole: true, status: true } } },
    orderBy: [{ createdAt: "desc" }, { eventAuditLogId: "desc" }],
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const auditLogs = hasMore ? rows.slice(0, query.limit) : rows;
  const last = auditLogs.at(-1);
  return { auditLogs, nextCursor: hasMore && last ? encodeCursor({ scope, createdAt: last.createdAt.toISOString(), eventAuditLogId: last.eventAuditLogId }) : null };
};

module.exports = {
  createEvent,
  listEvents,
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
};
