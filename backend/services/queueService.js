const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { createAuditLog } = require("../utils/audit");

const QUEUE_OPERATIONAL_ROLES = ["REGISTRATION_OFFICER", "SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"];
const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];
const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "CONFIRMED"];

const requireQueueManagement = async (db, eventId, user) => {
  const operational = (user.roles || []).some((role) => QUEUE_OPERATIONAL_ROLES.includes(role));
  if (!operational) throw new AppError(403, "QUEUE_ROLE_REQUIRED", "An operational role is required to manage queues");
  const event = await db.event.findUnique({
    where: { eventId },
    select: { eventId: true, name: true, status: true, venue: true },
  });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  if (event.status !== "IN_PROGRESS") {
    throw new AppError(409, "EVENT_NOT_IN_PROGRESS", "Queue operations are available only while the event is in progress");
  }
  return event;
};

const requireQueueStationOperation = async (db, eventId, stationId, user) => {
  if ((user.roles || []).includes("ADMINISTRATOR") || (user.roles || []).includes("EVENT_MANAGER")) {
    const event = await requireQueueManagement(db, eventId, user);
    const station = await db.station.findFirst({ where: { stationId, eventId, isActive: true } });
    if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station not found for this event");
    return { event, station };
  }

  if ((user.roles || []).includes("SCREENER")) {
    await requireQueueManagement(db, eventId, user);
    const station = await db.station.findFirst({ where: { stationId, eventId, isActive: true } });
    if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station not found for this event");
    const now = new Date();
    const assignment = await db.staffAssignment.findFirst({
      where: {
        eventId,
        userId: user.userId,
        assignmentRole: "SCREENER",
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        stationId,
        shift: { eventId, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new AppError(403, "FORBIDDEN", "You are not assigned to operate this station queue");
    }
    return { event: station, station };
  }

  throw new AppError(403, "QUEUE_ROLE_REQUIRED", "Screener, event manager, or administrator access is required");
};

const loadQueueEntry = async (db, queueId) => {
  const entry = await db.queueEntry.findUnique({
    where: { id: queueId },
    include: {
      registration: { select: { eventId: true, participantDisplayName: true } },
      station: { select: { stationId: true, stationName: true } },
    },
  });
  if (!entry) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found");
  return entry;
};

const joinQueue = async ({ eventId, stationId, registrationId }, user, context = null, db = prisma) => {
  await requireQueueManagement(db, eventId, user);
  const station = await db.station.findFirst({ where: { stationId, eventId, isActive: true } });
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station not found for this event");

  return db.$transaction(async (tx) => {
    const registration = await tx.eventRegistration.findFirst({ where: { registrationId, eventId } });
    if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
    if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
      throw new AppError(409, "REGISTRATION_NOT_QUEUEABLE", "Completed or cancelled registrations cannot join a queue");
    }

    const existing = await tx.queueEntry.findFirst({
      where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
      orderBy: { enteredAt: "desc" },
    });
    if (existing) {
      if (existing.stationId === stationId) {
        return { queueEntry: existing, created: false };
      }
      throw new AppError(
        409,
        "ALREADY_IN_QUEUE",
        "Registration is already in an active queue at another station",
        { queueEntryId: existing.id, stationId: existing.stationId },
      );
    }

    let queueNumber = registration.queueNumber;
    if (queueNumber == null) {
      const aggregate = await tx.eventRegistration.aggregate({ where: { eventId }, _max: { queueNumber: true } });
      queueNumber = (aggregate._max.queueNumber || 0) + 1;
    }

    const queueEntry = await tx.queueEntry.create({
      data: {
        registrationId,
        stationId,
        queueNumber,
        status: "WAITING",
      },
    });
    await createAuditLog({
      userId: user.userId,
      action: "QUEUE_JOINED",
      entityName: "QueueEntry",
      entityId: queueEntry.id,
      newValue: { eventId, stationId, registrationId, queueNumber, status: "WAITING" },
      context,
      client: tx,
    });
    return { queueEntry, created: true };
  });
};

const getEventQueueStatus = async (eventId, user, db = prisma) => {
  const event = await requireQueueManagement(db, eventId, user);
  const [stations, entries] = await Promise.all([
    db.station.findMany({
      where: { eventId, isActive: true },
      orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }],
    }),
    db.queueEntry.findMany({
      where: { station: { eventId } },
      include: { registration: { select: { participantDisplayName: true } } },
      orderBy: [{ queueNumber: "asc" }, { enteredAt: "asc" }],
    }),
  ]);

  const byStation = new Map(stations.map((station) => [station.stationId, {
    stationId: station.stationId,
    stationName: station.stationName,
    stationType: station.stationType,
    stationOrder: station.stationOrder,
    workload: { WAITING: 0, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
    nextUp: null,
  }]));

  for (const entry of entries) {
    const bucket = byStation.get(entry.stationId);
    if (!bucket) continue;
    bucket.workload[entry.status] += 1;
    if (entry.status === "WAITING" && !bucket.nextUp) {
      bucket.nextUp = {
        queueId: entry.id,
        queueNumber: entry.queueNumber,
        registrationId: entry.registrationId,
        participantDisplayName: entry.registration.participantDisplayName || "Unnamed participant",
      };
    }
  }

  return { event, stations: [...byStation.values()] };
};

const getParticipantQueueStatus = async (eventId, registrationId, user, db = prisma) => {
  await requireQueueManagement(db, eventId, user);
  const registration = await db.eventRegistration.findFirst({ where: { registrationId, eventId } });
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");

  const entries = await db.queueEntry.findMany({
    where: { registrationId },
    orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
    include: {
      station: { select: { stationId: true, stationName: true, stationType: true } },
      screeningResults: { select: { resultId: true, overallFlag: true } },
    },
  });
  const activeEntry = entries.find((entry) => ACTIVE_QUEUE_STATUSES.includes(entry.status)) || null;

  return {
    registrationId,
    queueNumber: registration.queueNumber,
    status: registration.registrationStatus,
    activeEntry,
    history: entries,
  };
};

const callQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found");
    if (current.status !== "WAITING") {
      throw new AppError(409, "INVALID_QUEUE_STATE", "Only a WAITING queue entry can be called", { status: current.status });
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueId },
      data: { status: "CALLED", calledAt: new Date() },
    });
    await createAuditLog({
      userId: user.userId,
      action: "QUEUE_CALLED",
      entityName: "QueueEntry",
      entityId: queueId,
      oldValue: { status: "WAITING" },
      newValue: { status: "CALLED" },
      context,
      client: tx,
    });
    return updated;
  });
};

const startQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found");
    if (current.status !== "CALLED") {
      throw new AppError(409, "INVALID_QUEUE_STATE", "Only a CALLED queue entry can be started", { status: current.status });
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
    await createAuditLog({
      userId: user.userId,
      action: "QUEUE_STARTED",
      entityName: "QueueEntry",
      entityId: queueId,
      oldValue: { status: "CALLED" },
      newValue: { status: "IN_PROGRESS" },
      context,
      client: tx,
    });
    return updated;
  });
};

const advanceQueueEntry = async ({ queueId, toStationId, reason = "STATION_TRANSFER" }, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);
  const targetStation = await db.station.findFirst({
    where: { stationId: toStationId, eventId: entry.registration.eventId, isActive: true },
  });
  if (!targetStation) throw new AppError(404, "STATION_NOT_FOUND", "Target station not found for this event");

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found");
    if (current.status === "COMPLETED" || current.status === "CANCELLED" || current.status === "SKIPPED") {
      throw new AppError(409, "INVALID_QUEUE_STATE", "A closed queue entry cannot be transferred", { status: current.status });
    }

    const completed = await tx.queueEntry.update({
      where: { id: queueId },
      data: { status: "COMPLETED", completedAt: new Date(), leftQueueAt: new Date() },
    });
    const nextEntry = await tx.queueEntry.create({
      data: {
        registrationId: current.registrationId,
        stationId: toStationId,
        queueNumber: current.queueNumber,
        status: "WAITING",
      },
    });
    await tx.queueMovement.create({
      data: {
        registrationId: current.registrationId,
        fromStationId: current.stationId,
        toStationId,
        movedBy: user.userId,
        movementReason: reason.slice(0, 100),
      },
    });
    await createAuditLog({
      userId: user.userId,
      action: "QUEUE_TRANSFERRED",
      entityName: "QueueEntry",
      entityId: nextEntry.id,
      oldValue: { queueEntryId: queueId, status: current.status, fromStationId: current.stationId },
      newValue: { status: "WAITING", toStationId },
      context,
      client: tx,
    });
    return { completed, nextEntry };
  });
};

const completeQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found");
    if (current.status !== "IN_PROGRESS") {
      throw new AppError(409, "INVALID_QUEUE_STATE", "Only an IN_PROGRESS queue entry can be completed", { status: current.status });
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueId },
      data: { status: "COMPLETED", completedAt: new Date(), leftQueueAt: new Date() },
    });

    const registration = await tx.eventRegistration.findUnique({ where: { registrationId: current.registrationId } });
    if (registration && registration.registrationStatus !== "COMPLETED") {
      await tx.eventRegistration.update({
        where: { registrationId: current.registrationId },
        data: { registrationStatus: "COMPLETED" },
      });
      await tx.registrationStatusHistory.create({
        data: {
          registrationId: current.registrationId,
          fromStatus: registration.registrationStatus,
          toStatus: "COMPLETED",
          changedById: user.userId,
          reason: "Completed the final queue station",
        },
      });
    }

    await createAuditLog({
      userId: user.userId,
      action: "QUEUE_COMPLETED",
      entityName: "QueueEntry",
      entityId: queueId,
      oldValue: { status: "IN_PROGRESS" },
      newValue: { status: "COMPLETED", registrationId: current.registrationId },
      context,
      client: tx,
    });
    return updated;
  });
};

const skipQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found");
    if (!["WAITING", "CALLED"].includes(current.status)) {
      throw new AppError(409, "INVALID_QUEUE_STATE", "Only a WAITING or CALLED queue entry can be skipped", { status: current.status });
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueId },
      data: { status: "SKIPPED", leftQueueAt: new Date() },
    });
    await createAuditLog({
      userId: user.userId,
      action: "QUEUE_SKIPPED",
      entityName: "QueueEntry",
      entityId: queueId,
      oldValue: { status: current.status },
      newValue: { status: "SKIPPED" },
      context,
      client: tx,
    });
    return updated;
  });
};

const leaveQueue = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found");
    if (current.status === "COMPLETED" || current.status === "CANCELLED") {
      throw new AppError(409, "INVALID_QUEUE_STATE", "A closed queue entry cannot be left again", { status: current.status });
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueId },
      data: { status: "CANCELLED", leftQueueAt: new Date() },
    });
    await createAuditLog({
      userId: user.userId,
      action: "QUEUE_LEFT",
      entityName: "QueueEntry",
      entityId: queueId,
      oldValue: { status: current.status },
      newValue: { status: "CANCELLED" },
      context,
      client: tx,
    });
    return updated;
  });
};

module.exports = {
  joinQueue,
  getEventQueueStatus,
  getParticipantQueueStatus,
  callQueueEntry,
  startQueueEntry,
  advanceQueueEntry,
  completeQueueEntry,
  skipQueueEntry,
  leaveQueue,
};
