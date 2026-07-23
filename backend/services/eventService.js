const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { encodeCursor, decodeCursor } = require("../utils/cursor");

const EVENT_FIELDS = ["name", "description", "bannerKey", "venue", "timezone", "startsAt", "endsAt", "capacity", "status", "version"];
const ACTIONS = {
  publish: { from: "DRAFT", to: "PUBLISHED", audit: "PUBLISHED" },
  start: { from: "PUBLISHED", to: "IN_PROGRESS", audit: "STARTED" },
  complete: { from: "IN_PROGRESS", to: "COMPLETED", audit: "COMPLETED" },
};

const snapshot = (event) => Object.fromEntries(EVENT_FIELDS.map((field) => [
  field,
  event[field] instanceof Date ? event[field].toISOString() : event[field],
]));

const eventInclude = {
  shifts: { orderBy: { startsAt: "asc" } },
  createdBy: { select: { userId: true, username: true, email: true, systemRole: true, status: true } },
  cancelledBy: { select: { userId: true, username: true, email: true, systemRole: true, status: true } },
};

const visibilityWhere = (user) => {
  if (user.systemRole === "ADMIN") return {};
  const assigned = { shifts: { some: { staffAssignments: { some: { userId: user.userId, status: { in: ["ASSIGNED", "CONFIRMED"] } } } } } };
  return user.systemRole === "EVENT_MANAGER"
    ? { OR: [{ createdByUserId: user.userId }, assigned] }
    : assigned;
};

const loadEventWithAssignment = (eventId, user) => prisma.event.findFirst({
  where: { eventId, ...visibilityWhere(user) },
  include: {
    ...eventInclude,
    shifts: {
      orderBy: { startsAt: "asc" },
      include: { staffAssignments: { where: { userId: user.userId }, select: { assignmentRole: true, status: true } } },
    },
  },
});

const canManage = (event, user) => user.systemRole === "ADMIN"
  || (user.systemRole === "EVENT_MANAGER" && (
    event.createdByUserId === user.userId
    || event.shifts.some((shift) => shift.staffAssignments.some((assignment) => assignment.assignmentRole === "EVENT_MANAGER" && ["ASSIGNED", "CONFIRMED"].includes(assignment.status)))
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
  ...(body.venue !== undefined ? { venue: body.venue } : {}),
  ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
  ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
  ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
  ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
});

const normalizeShift = (shift, eventId) => ({
  eventId,
  name: shift.name,
  startsAt: new Date(shift.startsAt),
  endsAt: new Date(shift.endsAt),
  requiredStaff: shift.requiredStaff,
});

const assertRange = (data, shifts) => {
  if (data.endsAt <= data.startsAt) throw new AppError(422, "INVALID_EVENT_RANGE", "Event end must be after its start");
  for (const shift of shifts) {
    if (new Date(shift.startsAt) < data.startsAt || new Date(shift.endsAt) > data.endsAt) {
      throw new AppError(422, "INVALID_SHIFT_RANGE", "Every shift must be within the event schedule");
    }
  }
};

const createEvent = async (body, user, correlationId) => {
  if (!["ADMIN", "EVENT_MANAGER"].includes(user.systemRole)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to create events");
  }
  return prisma.$transaction(async (tx) => {
  const eventData = normalizeEventData(body);
  assertRange(eventData, body.shifts);
  const event = await tx.event.create({
    data: {
      ...eventData,
      createdByUserId: user.userId,
      shifts: { create: body.shifts.map((shift) => ({ ...normalizeShift(shift), eventId: undefined })) },
    },
    include: eventInclude,
  });
  await tx.eventAuditLog.create({
    data: { eventId: event.eventId, actorUserId: user.userId, action: "CREATED", afterSnapshot: snapshot(event), correlationId },
  });
    return event;
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
  const rows = await prisma.event.findMany({ where, include: eventInclude, orderBy: [{ startsAt: "asc" }, { eventId: "asc" }], take: query.limit + 1 });
  const hasMore = rows.length > query.limit;
  const events = hasMore ? rows.slice(0, query.limit) : rows;
  const last = events.at(-1);
  return {
    events,
    nextCursor: hasMore && last ? encodeCursor({ scope, startsAt: last.startsAt.toISOString(), eventId: last.eventId }) : null,
  };
};

const getEvent = (eventId, user) => requireEvent(eventId, user);

const allowedUpdateKeys = {
  DRAFT: new Set(["name", "description", "bannerKey", "venue", "timezone", "startsAt", "endsAt", "capacity", "shifts"]),
  PUBLISHED: new Set(["name", "description", "bannerKey", "venue", "timezone", "startsAt", "endsAt", "capacity", "shifts"]),
  IN_PROGRESS: new Set(["description", "bannerKey", "capacity"]),
  COMPLETED: new Set(["bannerKey"]),
  CANCELLED: new Set(["bannerKey"]),
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
    if (body.shifts) {
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
    }

    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.eventAuditLog.create({
      data: { eventId, actorUserId: user.userId, action: "UPDATED", beforeSnapshot: snapshot(current), afterSnapshot: snapshot(updated), correlationId },
    });
    return updated;
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
    }
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.eventAuditLog.create({ data: { eventId, actorUserId: user.userId, action: transition.audit, beforeSnapshot: snapshot(current), afterSnapshot: snapshot(updated), correlationId } });
    return updated;
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
    const updated = await tx.event.findUniqueOrThrow({ where: { eventId }, include: eventInclude });
    await tx.eventAuditLog.create({ data: { eventId, actorUserId: user.userId, action: "CANCELLED", beforeSnapshot: snapshot(current), afterSnapshot: snapshot(updated), correlationId } });
    return updated;
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

module.exports = { createEvent, listEvents, getEvent, updateEvent, transitionEvent, cancelEvent, getAuditLog };
