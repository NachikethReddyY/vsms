const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { createAuditLog } = require("../utils/audit");
const { requireQueueAccess } = require("./eventAuthorizationService");

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];

const stationStatus = (station, activeQueueCount = 0) => {
  if (!station.isActive || station.operationalStatus === "OFFLINE") return "OFFLINE";
  if (station.operationalStatus === "PAUSED") return "PAUSED";
  return activeQueueCount > 0 ? "BUSY" : "AVAILABLE";
};

const assertStationSelectable = (station) => {
  const status = stationStatus(station);
  if (status === "PAUSED" || status === "OFFLINE") {
    throw new AppError(409, "STATION_UNAVAILABLE", "The selected station is no longer available", { status });
  }
  return status;
};

const handoffResponse = ({ registration, station, queueEntry, created, stationStatusBeforeHandoff }) => ({
  created,
  registrationId: registration.registrationId,
  queueEntryId: queueEntry.id,
  participant: {
    id: registration.participant.id,
    participantReference: registration.participant.participantReference,
    name: `${registration.participant.firstName} ${registration.participant.lastName}`,
  },
  event: {
    id: registration.event.eventId,
    name: registration.event.name,
  },
  queueNumber: queueEntry.queueNumber,
  nextStation: station.stationName,
  assignedStation: {
    id: station.stationId,
    name: station.stationName,
    status: "BUSY",
    statusBeforeHandoff: stationStatusBeforeHandoff,
  },
});

const requireQueueManagement = async (db, eventId, user, stationId = null) => {
  await requireQueueAccess(eventId, user, { db, stationId });
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
  const authorization = await requireQueueAccess(eventId, user, { db, stationId });
  const station = await db.station.findFirst({ where: { stationId, eventId, isActive: true } });
  if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station not found for this event");
  return { event: authorization.event, station };
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
  await requireQueueManagement(db, eventId, user, stationId);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const station = await tx.station.findFirst({ where: { stationId, eventId } });
        if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station not found for this event");
        assertStationSelectable(station);

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
          if (existing.stationId === stationId) return { queueEntry: existing, created: false };
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
          await tx.eventRegistration.update({ where: { registrationId }, data: { queueNumber } });
        }

        const queueEntry = await tx.queueEntry.create({
          data: { registrationId, stationId, queueNumber, status: "WAITING" },
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
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const target = JSON.stringify(error.meta?.target || "");
      if ((error.code === "P2034" || (error.code === "P2002" && target.includes("queue"))) && attempt < 3) continue;
      throw error;
    }
  }

  throw new AppError(409, "QUEUE_JOIN_CONFLICT", "Unable to reserve a queue position. Please try again.");
};

const listRegistrationStations = async (eventId, user, db = prisma) => {
  const event = await requireQueueManagement(db, eventId, user);
  const [stations, activeEntries] = await Promise.all([
    db.station.findMany({
      where: { eventId },
      orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }],
    }),
    db.queueEntry.findMany({
      where: { station: { eventId }, status: { in: ACTIVE_QUEUE_STATUSES } },
      select: { stationId: true },
    }),
  ]);
  const activeCounts = new Map();
  for (const entry of activeEntries) activeCounts.set(entry.stationId, (activeCounts.get(entry.stationId) || 0) + 1);

  return {
    event,
    stations: stations.map((station) => {
      const activeQueueCount = activeCounts.get(station.stationId) || 0;
      const status = stationStatus(station, activeQueueCount);
      return {
        stationId: station.stationId,
        stationName: station.stationName,
        stationType: station.stationType,
        stationOrder: station.stationOrder,
        status,
        activeQueueCount,
        selectable: status === "AVAILABLE" || status === "BUSY",
      };
    }),
  };
};

const createQueueHandoff = async ({ eventId, stationId, registrationId }, user, context = null, db = prisma) => {
  await requireQueueManagement(db, eventId, user, stationId);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const registration = await tx.eventRegistration.findFirst({
          where: { registrationId, eventId },
          include: {
            participant: { select: { id: true, participantReference: true, firstName: true, lastName: true } },
            event: { select: { eventId: true, name: true } },
          },
        });
        if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found for this event");
        if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
          throw new AppError(409, "REGISTRATION_NOT_QUEUEABLE", "Completed or cancelled registrations cannot join a queue");
        }

        const station = await tx.station.findFirst({ where: { stationId, eventId } });
        if (!station) throw new AppError(404, "STATION_NOT_FOUND", "Station not found for this event");
        const stationStatusBeforeHandoff = assertStationSelectable(station);

        const existing = await tx.queueEntry.findFirst({
          where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
          orderBy: { enteredAt: "desc" },
        });
        if (existing) {
          if (existing.stationId === stationId) {
            return handoffResponse({ registration, station, queueEntry: existing, created: false, stationStatusBeforeHandoff });
          }
          throw new AppError(409, "ALREADY_IN_QUEUE", "Registration is already in an active queue", {
            queueEntryId: existing.id,
            stationId: existing.stationId,
          });
        }

        let queueNumber = registration.queueNumber;
        if (queueNumber == null) {
          const aggregate = await tx.eventRegistration.aggregate({ where: { eventId }, _max: { queueNumber: true } });
          queueNumber = (aggregate._max.queueNumber || 0) + 1;
          await tx.eventRegistration.update({ where: { registrationId }, data: { queueNumber } });
        }

        const queueEntry = await tx.queueEntry.create({
          data: { registrationId, stationId, queueNumber, status: "WAITING" },
        });
        await createAuditLog({
          userId: user.userId,
          action: "REGISTRATION_QUEUE_HANDOFF_CREATED",
          entityName: "QueueEntry",
          entityId: queueEntry.id,
          newValue: { eventId, stationId, registrationId, queueNumber, stationStatusBeforeHandoff },
          context,
          client: tx,
        });
        return handoffResponse({ registration, station, queueEntry, created: true, stationStatusBeforeHandoff });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const target = JSON.stringify(error.meta?.target || "");
      if ((error.code === "P2034" || (error.code === "P2002" && target.includes("queue"))) && attempt < 3) continue;
      throw error;
    }
  }

  throw new AppError(409, "QUEUE_HANDOFF_CONFLICT", "Unable to reserve a queue position. Please select a station again.");
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
  if (!eventId) {
    const scoped = await db.eventRegistration.findUnique({ where: { registrationId }, select: { eventId: true } });
    if (!scoped) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    eventId = scoped.eventId;
  }
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

const callQueueEntry = async (queueId, user, context = null, db = prisma, expectedEventId = null) => {
  const entry = await loadQueueEntry(db, queueId);
  if (expectedEventId && entry.registration.eventId !== expectedEventId) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found for this event");
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

const startQueueEntry = async (queueId, user, context = null, db = prisma, expectedEventId = null) => {
  const entry = await loadQueueEntry(db, queueId);
  if (expectedEventId && entry.registration.eventId !== expectedEventId) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found for this event");
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

const advanceQueueEntry = async ({ queueId, toStationId, reason = "STATION_TRANSFER", eventId = null }, user, context = null, db = prisma) => {
  const entry = await loadQueueEntry(db, queueId);
  if (eventId && entry.registration.eventId !== eventId) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found for this event");
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

const completeQueueEntry = async (queueId, user, context = null, db = prisma, expectedEventId = null) => {
  const entry = await loadQueueEntry(db, queueId);
  if (expectedEventId && entry.registration.eventId !== expectedEventId) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found for this event");
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

const skipQueueEntry = async (queueId, user, context = null, db = prisma, expectedEventId = null) => {
  const entry = await loadQueueEntry(db, queueId);
  if (expectedEventId && entry.registration.eventId !== expectedEventId) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found for this event");
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

const leaveQueue = async (queueId, user, context = null, db = prisma, expectedEventId = null) => {
  const entry = await loadQueueEntry(db, queueId);
  if (expectedEventId && entry.registration.eventId !== expectedEventId) throw new AppError(404, "QUEUE_ENTRY_NOT_FOUND", "Queue entry not found for this event");
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
  listRegistrationStations,
  createQueueHandoff,
  getEventQueueStatus,
  getParticipantQueueStatus,
  callQueueEntry,
  startQueueEntry,
  advanceQueueEntry,
  completeQueueEntry,
  skipQueueEntry,
  leaveQueue,
};
