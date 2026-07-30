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
      staffAssignmentId: assignment.id,
      userId: assignment.assignedUser?.id,
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
        where: { status: { not: "CANCELLED" } },
        orderBy: { assignedAt: "asc" },
        select: {
          id: true,
          assignmentRole: true,
          status: true,
          notes: true,
          assignedUser: { select: { id: true, username: true } },
          station: { select: { stationId: true, stationName: true, stationOrder: true } },
        },
      },
    },
  },
  stations: {
    orderBy: { stationOrder: "asc" },
  },
  createdBy: { select: { id: true, username: true, email: true, sysRole: true, status: true, createdAt: true } },
  cancelledBy: { select: { id: true, username: true, email: true, sysRole: true, status: true, createdAt: true } },
  registrations: {
    where: { registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] } },
    select: { registrationId: true },
  },
  _count: { select: { registrations: true } },
};

const toEventResponse = ({ _count, registrations, stations, ...event }, user) => ({
  ...event,
  createdBy: event.createdBy && { ...event.createdBy, userId: event.createdBy.id, systemRole: event.createdBy.sysRole },
  cancelledBy: event.cancelledBy && { ...event.cancelledBy, userId: event.cancelledBy.id, systemRole: event.cancelledBy.sysRole },
  eventDays: (event.eventDays || []).map((day) => ({
    ...day,
    date: day.date instanceof Date ? day.date.toISOString().slice(0, 10) : String(day.date).slice(0, 10),
  })),
  eventStations: (stations || []).map((station) => ({
    eventStationId: station.stationId,
    stationTemplateId: station.stationId,
    templateVersion: 1,
    name: station.stationName,
    stationOrder: station.stationOrder,
    capacity: 1,
    isAvailable: station.isActive,
    availabilities: [],
  })),
  shifts: (event.shifts || []).map((shift) => ({
    ...shift,
    staffAssignments: shift.staffAssignments.map((assignment) => ({
      staffAssignmentId: assignment.id,
      assignmentRole: assignment.assignmentRole,
      status: assignment.status,
      notes: assignment.notes,
      eventStation: assignment.station && {
        eventStationId: assignment.station.stationId,
        stationTemplateId: assignment.station.stationId,
        name: assignment.station.stationName,
        stationOrder: assignment.station.stationOrder,
      },
      user: {
        userId: assignment.assignedUser.id,
        username: assignment.assignedUser.username,
      },
    })),
  })),
  signupCount: _count ? _count.registrations : 0,
  activeCapacityCount: registrations ? registrations.length : 0,
  canManage: canManage(event, user),
});

const visibilityWhere = (user) => {
  if (!user) return {};
  if (user.systemRole === "SUPER_ADMIN" || user.systemRole === "ADMIN") return {};
  const assigned = {
    shifts: {
      some: {
        staffAssignments: {
          some: { userId: user.id, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        },
      },
    },
  };
  return user.systemRole === "EVENT_MANAGER"
    ? { OR: [{ createdByUserId: user.id }, assigned] }
    : assigned;
};

const loadEventWithAssignment = (eventId, user, db = prisma) =>
  db.event.findFirst({
    where: { eventId, ...visibilityWhere(user) },
    include: eventInclude,
  });

const canManage = (event, user) => {
  if (!user) return false;
  return (
    user.systemRole === "SUPER_ADMIN" ||
    user.systemRole === "ADMIN" ||
    (user.systemRole === "EVENT_MANAGER" &&
      (event.createdByUserId === user.id ||
        (event.shifts || []).some((shift) =>
          (shift.staffAssignments || []).some(
            (assignment) =>
              assignment.assignmentRole === "EVENT_MANAGER" &&
              ["ASSIGNED", "CONFIRMED"].includes(assignment.status) &&
              assignment.assignedUser?.id === user.id
          )
        )))
  );
};

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
  ...(eventId ? { eventId } : {}),
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
  for (const shift of shifts || []) {
    if (new Date(shift.startsAt) < data.startsAt || new Date(shift.endsAt) > data.endsAt) {
      throw new AppError(422, "INVALID_SHIFT_RANGE", "Every shift must be within the event schedule");
    }
  }
};

const schedulesOverlap = (a, b) => new Date(a.startsAt) < new Date(b.endsAt) && new Date(a.endsAt) > new Date(b.startsAt);

const lockStaffSchedules = async (tx, userIds) => {
  if (!userIds || userIds.length === 0) return;
  await tx.$executeRawUnsafe(
    `SELECT * FROM "users" WHERE "user_id" = ANY($1::uuid[]) FOR UPDATE`,
    userIds
  );
};

const scheduleConflictError = () => new AppError(409, "SCHEDULE_CONFLICT", "Staff member has a conflicting shift assignment");

const assertShiftSchedulesAvailable = async (tx, eventId, desiredShifts, currentShifts) => {
  const desiredById = new Map((desiredShifts || []).filter((shift) => shift.shiftId).map((shift) => [shift.shiftId, shift]));
  const schedules = (currentShifts || []).flatMap((shift) => {
    const desired = desiredById.get(shift.shiftId);
    if (!desired) return [];
    return (shift.staffAssignments || [])
      .filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status))
      .map((assignment) => ({
        userId: assignment.assignedUser.id,
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
  const schedules = (shifts || []).flatMap((shift) => (shift.assignments || []).map((assignment) => ({
    userId: assignment.userId,
    startsAt: new Date(shift.startsAt),
    endsAt: new Date(shift.endsAt),
  })));
  if (schedules.length === 0) return;
  await lockStaffSchedules(tx, schedules.map(({ userId }) => userId));

  const uniqueUserIds = [...new Set(schedules.map(({ userId }) => userId))];
  const activeUsers = await tx.user.count({
    where: { id: { in: uniqueUserIds }, status: "ACTIVE" },
  });
  if (activeUsers !== uniqueUserIds.length) {
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
        where: { createdByUserId_createIdempotencyKey: { createdByUserId: user.id, createIdempotencyKey: idempotencyKey } },
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
    
    const event = await tx.event.create({
      data: {
        ...eventData,
        createdByUserId: user.id,
        createIdempotencyKey: idempotencyKey,
        createPayloadHash: idempotencyKey ? payloadHash : null,
        shifts: { create: (body.shifts || []).map((shift) => normalizeShift(shift)) },
      },
      include: eventInclude,
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "CREATED",
        entityName: "Event",
        entityId: event.eventId,
        newValue: snapshot(event),
        ipAddress: "::1",
        deviceName: "Server",
      },
    });
    return toEventResponse(event, user);
  });
};

const listEvents = async (query, user) => {
  const scope = `events:${query.status || "all"}:${query.search || ""}:${query.limit}`;
  const cursor = decodeCursor(query.cursor, scope);
  
  const visibilityCondition = visibilityWhere(user);
  const conditions = [];

  if (Object.keys(visibilityCondition).length > 0) {
    conditions.push(visibilityCondition);
  }
  if (query.status) {
    conditions.push({ status: query.status });
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
          eventId: { gt: cursor.eventId },
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

const getEvent = async (eventId, user) => toEventResponse(await requireEvent(eventId, user), user);

const allowedUpdateKeys = {
  DRAFT: new Set(["name", "description", "bannerKey", "artworkDataUrl", "venue", "timezone", "startsAt", "endsAt", "capacity", "shifts", "eventDays", "stations"]),
  PUBLISHED: new Set(["name", "description", "bannerKey", "artworkDataUrl", "venue", "timezone", "startsAt", "endsAt", "capacity", "shifts", "eventDays", "stations"]),
  UPCOMING: new Set(["name", "description", "bannerKey", "artworkDataUrl", "venue", "timezone", "startsAt", "endsAt", "capacity", "shifts", "eventDays", "stations"]),
  ONGOING: new Set(["description", "bannerKey", "artworkDataUrl", "capacity"]),
  IN_PROGRESS: new Set(["description", "bannerKey", "artworkDataUrl", "capacity"]),
  COMPLETED: new Set(["bannerKey", "artworkDataUrl"]),
  CANCELLED: new Set(["bannerKey", "artworkDataUrl"]),
};

const updateEvent = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);
  const suppliedKeys = Object.keys(body).filter((key) => !["version"].includes(key));

  if (suppliedKeys.some((key) => !allowedUpdateKeys[current.status]?.has(key))) {
    throw new AppError(409, "EVENT_NOT_EDITABLE", "One or more fields cannot be changed in the current event state");
  }

  if (
    ["IN_PROGRESS", "ONGOING"].includes(current.status) &&
    body.capacity !== undefined &&
    body.capacity < current.capacity
  ) {
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

    if (body.stations) {
      for (const input of body.stations) {
        let station = await tx.eventStation.findFirst({
          where: { eventId, stationTemplateId: input.stationTemplateId }
        });

        if (station) {
          station = await tx.eventStation.update({
            where: { eventStationId: station.eventStationId },
            data: {
              name: input.name,
              description: input.description,
              capacity: input.capacity,
              isAvailable: input.isAvailable,
              stationOrder: input.stationOrder,
            }
          });
        } else {
          station = await tx.eventStation.create({
            data: {
              eventId,
              stationTemplateId: input.stationTemplateId,
              templateVersion: input.templateVersion ?? 1,
              name: input.name,
              description: input.description,
              stationOrder: input.stationOrder,
              capacity: input.capacity,
              isAvailable: input.isAvailable,
            }
          });
        }

        stationsByTemplate.set(input.stationTemplateId, station);
        await tx.eventStationAvailability.deleteMany({ where: { eventStationId: station.eventStationId } });
        
        if (input.availabilities) {
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
      const existingById = new Map((current.shifts || []).map((shift) => [shift.shiftId, shift]));
      const desiredIds = body.shifts.flatMap((shift) => shift.shiftId ? [shift.shiftId] : []);
      
      const unknown = desiredIds.find((id) => !existingById.has(id));
      if (unknown) throw new AppError(422, "INVALID_SHIFT", "A shift does not belong to this event");
      
      const protectedRemoval = (current.shifts || []).find((shift) => !desiredIds.includes(shift.shiftId) && shift.status !== "PLANNED");
      if (protectedRemoval) throw new AppError(409, "SHIFT_NOT_REMOVABLE", "Active or completed shifts cannot be removed");

      await tx.shift.deleteMany({ where: { eventId, status: "PLANNED", shiftId: { notIn: desiredIds } } });
      
      for (const shift of body.shifts) {
        if (shift.shiftId) {
          await tx.shift.update({ where: { shiftId: shift.shiftId }, data: normalizeShift(shift, eventId) });
        } else {
          await tx.shift.create({ data: normalizeShift(shift, eventId) });
        }
      }
      await createShiftAssignments(tx, eventId, body.shifts, stationsByTemplate, user.id);
    }

    const updated = await tx.event.findUniqueOrThrow({
      where: { eventId },
      include: eventInclude,
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "UPDATED",
        entityName: "Event",
        entityId: eventId,
        oldValue: snapshot(current),
        newValue: snapshot(updated),
        ipAddress: "::1",
      },
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

    const updated = await tx.event.findUniqueOrThrow({
      where: { eventId },
      include: eventInclude,
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: transition.audit,
        entityName: "Event",
        entityId: eventId,
        oldValue: snapshot(current),
        newValue: snapshot(updated),
        ipAddress: "::1",
        deviceName: "Server",
      },
    });

    return toEventResponse(updated, user);
  });
};

const cancelEvent = async (eventId, body, user, correlationId) => {
  const current = await requireEvent(eventId, user, true);

  if (
    !["DRAFT", "PUBLISHED", "UPCOMING", "IN_PROGRESS", "ONGOING"].includes(current.status) ||
    (["IN_PROGRESS", "ONGOING"].includes(current.status) && !["SUPER_ADMIN", "ADMIN"].includes(user.systemRole))
  ) {
    throw new AppError(409, "INVALID_EVENT_TRANSITION", "Event cannot be cancelled from its current state");
  }
  
  return prisma.$transaction(async (tx) => {
    const changed = await tx.event.updateMany({
      where: { eventId, version: body.version, status: current.status },
      data: {
        status: "CANCELLED",
        cancellationReason: body.reason,
        cancelledAt: new Date(),
        cancelledByUserId: user.id,
        version: { increment: 1 },
      },
    });

    if (changed.count !== 1) {
      throw new AppError(409, "STALE_EVENT_VERSION", "This event was changed by someone else");
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
        userId: user.id,
        action: "CANCELLED",
        entityName: "Event",
        entityId: eventId,
        oldValue: snapshot(current),
        newValue: snapshot(updated),
        ipAddress: "::1",
        deviceName: "Server",
      },
    });

    return toEventResponse(updated, user);
  });
};

const listStaffDirectory = async () =>
  prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: "asc" },
    take: 200,
  });

module.exports = {
  createEvent,
  listEvents,
  getEvent,
  updateEvent,
  transitionEvent,
  cancelEvent,
  listStaffDirectory,
};
