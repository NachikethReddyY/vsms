/**
 * @fileoverview Queue & Station Transfer Service Layer
 * @module services/queueService
 * @description Implements business logic, state validations, database transactions, and audit logging for virtual queues, station routing, and workflow transitions.
 */

const prisma = require("../prisma/prismaClient");
const { AppError, ValidationError, NotFoundError, ConflictError } = require("../middlewares/errorHandler");
const { createAuditLog } = require("../utils/audit");

const QUEUE_OPERATIONAL_ROLES = ["REGISTRATION_OFFICER", "SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"];
const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];
const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "CONFIRMED"];

/**
 * Validates that the user has operational rights and that the event is actively in progress.
 * @private
 */
const requireQueueManagement = async (db, eventId, user) => {
  const operational = (user.roles || []).some((role) => QUEUE_OPERATIONAL_ROLES.includes(role));
  if (!operational) {
    throw new AppError("An operational role is required to manage queues", 403, "FORBIDDEN");
  }
  
  const event = await db.event.findUnique({
    where: { eventId },
    select: { eventId: true, name: true, status: true, venue: true },
  });
  
  if (!event) throw new NotFoundError("Event not found");
  if (event.status !== "IN_PROGRESS") {
    throw new AppError("Queue operations are available only while the event is in progress", 409, "CONFLICT");
  }
  return event;
};

/**
 * Validates station assignment rules for Screeners versus Management.
 * @private
 */
const requireQueueStationOperation = async (db, eventId, stationId, user) => {
  const roles = user.roles || [];
  
  if (roles.includes("ADMINISTRATOR") || roles.includes("EVENT_MANAGER")) {
    const event = await requireQueueManagement(db, eventId, user);
    const station = await db.station.findFirst({ where: { stationId, eventId, isActive: true } });
    if (!station) throw new NotFoundError("Station not found for this event");
    return { event, station };
  }

  if (roles.includes("SCREENER")) {
    await requireQueueManagement(db, eventId, user);
    const station = await db.station.findFirst({ where: { stationId, eventId, isActive: true } });
    if (!station) throw new NotFoundError("Station not found for this event");
    
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
      throw new AppError("You are not assigned to operate this station queue", 403, "FORBIDDEN");
    }
    return { event: station, station };
  }

  throw new AppError("Screener, event manager, or administrator access is required", 403, "FORBIDDEN");
};

/**
 * Loads a queue entry with associated relations or throws NotFound.
 * @private
 */
const loadQueueEntry = async (db, queueId) => {
  const entry = await db.queueEntry.findUnique({
    where: { id: queueId },
    include: {
      registration: { select: { eventId: true, participantDisplayName: true } },
      station: { select: { stationId: true, stationName: true } },
    },
  });
  if (!entry) throw new NotFoundError("Queue entry not found");
  return entry;
};

/**
 * Enters a participant into a station's virtual queue.
 */
const joinQueue = async ({ eventId, stationId, registrationId }, user, context = null, db = prisma) => {
  await requireQueueManagement(db, eventId, user);
  const station = await db.station.findFirst({ where: { stationId, eventId, isActive: true } });
  if (!station) throw new NotFoundError("Station not found for this event");

  return db.$transaction(async (tx) => {
    const registration = await tx.eventRegistration.findFirst({ where: { registrationId, eventId } });
    if (!registration) throw new NotFoundError("Registration not found for this event");
    
    if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
      throw new ConflictError("Completed or cancelled registrations cannot join a queue");
    }

    const existing = await tx.queueEntry.findFirst({
      where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
      orderBy: { enteredAt: "desc" },
    });
    
    if (existing) {
      if (existing.stationId === stationId) {
        return { queueEntry: existing, created: false };
      }
      throw new ConflictError("Registration is already in an active queue at another station");
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

/**
 * Retrieves the live status of all queues across stations for an event.
 */
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

/**
 * Tracks an individual participant's complete queue timeline and history.
 */
const getParticipantQueueStatus = async (eventId, registrationId, user, db = prisma) => {
  await requireQueueManagement(db, eventId, user);
  const registration = await db.eventRegistration.findFirst({ where: { registrationId, eventId } });
  if (!registration) throw new NotFoundError("Registration not found for this event");

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

/**
 * Automatically fetches the next waiting participant for a given station.
 */
const getNextQueueEntry = async (eventId, stationId, user, db = prisma) => {
  await requireQueueStationOperation(db, eventId, stationId, user);
  const nextEntry = await db.queueEntry.findFirst({
    where: { stationId, status: "WAITING" },
    orderBy: [{ queueNumber: "asc" }, { enteredAt: "asc" }],
    include: { registration: { select: { participantDisplayName: true } } },
  });
  return nextEntry || null;
};

/**
 * Calls a waiting participant to the station desk.
 */
const callQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new NotFoundError("Queue entry not found");
    if (current.status !== "WAITING") {
      throw new ConflictError("Only a WAITING queue entry can be called");
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

/**
 * Starts active screening/processing for a called participant.
 */
const startQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new NotFoundError("Queue entry not found");
    if (current.status !== "CALLED") {
      throw new ConflictError("Only a CALLED queue entry can be started");
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

/**
 * Transfers a participant from the current station to a target destination station.
 */
const transferQueueEntry = async ({ queueId, toStationId, reason = "STATION_TRANSFER" }, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);
  
  const targetStation = await db.station.findFirst({
    where: { stationId: toStationId, eventId: entry.registration.eventId, isActive: true },
  });
  if (!targetStation) throw new NotFoundError("Target station not found for this event");

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new NotFoundError("Queue entry not found");
    if (["COMPLETED", "CANCELLED", "SKIPPED"].includes(current.status)) {
      throw new ConflictError("A closed queue entry cannot be transferred");
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

/**
 * Alias/Wrapper for advanceQueueEntry to satisfy test suites calling advanceQueueEntry directly.
 */
const advanceQueueEntry = async (queueId, targetStationId, user, context = null, db = prisma) => {
  return transferQueueEntry({ queueId, toStationId: targetStationId }, user, context, db);
};

/**
 * Marks the active station queue entry as completed.
 */
const completeQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new NotFoundError("Queue entry not found");
    if (current.status !== "IN_PROGRESS") {
      throw new ConflictError("Only an IN_PROGRESS queue entry can be completed");
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

/**
 * Skips an unresponsive queue participant.
 */
const skipQueueEntry = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new NotFoundError("Queue entry not found");
    if (!["WAITING", "CALLED"].includes(current.status)) {
      throw new ConflictError("Only a WAITING or CALLED queue entry can be skipped");
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

/**
 * Removes/cancels a participant entry from the queue entirely.
 */
const leaveQueue = async (queueId, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  await requireQueueStationOperation(db, entry.registration.eventId, entry.stationId, user);

  return db.$transaction(async (tx) => {
    const current = await tx.queueEntry.findUnique({ where: { id: queueId } });
    if (!current) throw new NotFoundError("Queue entry not found");
    if (["COMPLETED", "CANCELLED"].includes(current.status)) {
      throw new ConflictError("A closed queue entry cannot be left again");
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

/**
 * Fetches real-time station workload metrics and volume data.
 */
const getStationWorkload = async (eventId, user, db = prisma) => {
  const statusPayload = await getEventQueueStatus(eventId, user, db);
  return statusPayload.stations.map((station) => ({
    stationId: station.stationId,
    stationName: station.stationName,
    stationType: station.stationType,
    workload: station.workload,
  }));
};

module.exports = {
  joinQueue,
  getEventQueueStatus,
  getParticipantQueueStatus,
  getNextQueueEntry,
  callQueueEntry,
  startQueueEntry,
  transferQueueEntry,
  advanceQueueEntry,
  completeQueueEntry,
  skipQueueEntry,
  leaveQueue,
  getStationWorkload,
};