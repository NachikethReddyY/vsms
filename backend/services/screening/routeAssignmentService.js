const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { createAuditLog } = require("../../utils/logging/audit");
const { SUPPORTED_SCREENING_STATION_TYPES } = require("../event/stationTemplateMapping");
const { orderRouteStations } = require("./routePolicy");
const {
  ACTIVE_QUEUE_STATUSES,
  createInitialQueueEntry,
} = require("./routeProgressionService");

const routeStepSelect = {
  routeStepId: true,
  stationId: true,
  position: true,
  completedAt: true,
  station: {
    select: {
      stationName: true,
      stationType: true,
    },
  },
};

const stationIsAvailable = (station, availability, now) => (
  station.operationalStatus !== "PAUSED"
  && station.operationalStatus !== "OFFLINE"
  && (!availability || (
    availability.isAvailable
    && (!availability.startsAt || availability.startsAt <= now)
    && (!availability.endsAt || availability.endsAt > now)
  ))
);

const stationCapacity = (station, availability) => Math.max(
  1,
  Number(availability?.capacity) || Number(station.stationTemplate?.defaultCapacity) || 1,
);

const loadRouteCandidates = async (tx, eventId, now = new Date()) => {
  const [stations, activeEntries, availabilities] = await Promise.all([
    tx.station.findMany({
      where: {
        eventId,
        isActive: true,
        stationType: { in: SUPPORTED_SCREENING_STATION_TYPES },
      },
      select: {
        stationId: true,
        stationName: true,
        stationType: true,
        stationOrder: true,
        operationalStatus: true,
        stationTemplate: { select: { defaultCapacity: true } },
      },
    }),
    tx.queueEntry.findMany({
      where: {
        station: { eventId },
        status: { in: ACTIVE_QUEUE_STATUSES },
      },
      select: { stationId: true },
    }),
    tx.eventStationAvailability.findMany({
      where: {
        eventDay: {
          eventId,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      },
      select: {
        eventStationId: true,
        capacity: true,
        isAvailable: true,
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);

  const activeCounts = new Map();
  for (const { stationId } of activeEntries) {
    activeCounts.set(stationId, (activeCounts.get(stationId) || 0) + 1);
  }
  const availabilityByStation = new Map(
    availabilities.map((availability) => [availability.eventStationId, availability]),
  );

  return orderRouteStations(stations.map((station) => {
    const availability = availabilityByStation.get(station.stationId);
    return {
      stationId: station.stationId,
      stationName: station.stationName,
      stationType: station.stationType,
      stationOrder: station.stationOrder,
      activeQueueCount: activeCounts.get(station.stationId) || 0,
      capacity: stationCapacity(station, availability),
      available: stationIsAvailable(station, availability, now),
    };
  }));
};

const safeQueue = (queueEntry) => queueEntry && ({
  queueEntryId: queueEntry.id,
  stationId: queueEntry.stationId,
  queueNumber: queueEntry.queueNumber,
  status: queueEntry.status,
});

const safeStep = (step, activeStationId, blocked) => ({
  stationId: step.stationId,
  stationName: step.station?.stationName || step.stationName,
  stationType: step.station?.stationType || step.stationType,
  position: step.position,
  state: step.completedAt
    ? "COMPLETED"
    : step.stationId === activeStationId
      ? "CURRENT"
      : blocked && step.position === 1
        ? "BLOCKED"
        : "UPCOMING",
});

const buildRouteState = ({ routeVersion, steps, queueEntry, eventInProgress = true }) => {
  if (!steps.length) {
    return {
      status: eventInProgress ? "NO_SCREENING_STATIONS" : "PENDING_CHECK_IN",
      routeVersion,
      steps: [],
      currentStation: null,
      queue: null,
    };
  }

  if (steps.every(({ completedAt }) => completedAt)) {
    return {
      status: "REVIEW_READY",
      routeVersion,
      steps: steps.map((step) => safeStep(step, null, false)),
      currentStation: null,
      queue: null,
    };
  }

  const blocked = !queueEntry;
  const safeSteps = steps.map((step) => safeStep(step, queueEntry?.stationId, blocked));
  return {
    status: blocked ? "NEEDS_STAFF_ACTION" : "READY",
    routeVersion,
    steps: safeSteps,
    currentStation: safeSteps.find(({ state }) => state === "CURRENT") || null,
    queue: safeQueue(queueEntry),
  };
};

const getRouteState = async (tx, registrationId, eventInProgress = true) => {
  const [registration, steps, queueEntry] = await Promise.all([
    tx.eventRegistration.findUnique({
      where: { registrationId },
      select: { routeVersion: true },
    }),
    tx.registrationRouteStep.findMany({
      where: { registrationId },
      select: routeStepSelect,
      orderBy: { position: "asc" },
    }),
    tx.queueEntry.findFirst({
      where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
      orderBy: { enteredAt: "desc" },
    }),
  ]);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
  return buildRouteState({
    routeVersion: registration.routeVersion,
    steps,
    queueEntry,
    eventInProgress,
  });
};

const assignRouteOnce = async ({
  tx,
  registrationId,
  eventId,
  actorUserId = null,
  context = null,
  now = new Date(),
}) => {
  const registration = await tx.eventRegistration.findUnique({
    where: { registrationId },
    select: {
      registrationId: true,
      eventId: true,
      routeVersion: true,
      event: { select: { status: true } },
    },
  });
  if (!registration || registration.eventId !== eventId) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found for this event.");
  }
  if (registration.event.status !== "IN_PROGRESS") {
    throw new AppError(409, "EVENT_NOT_IN_PROGRESS", "Routes can be assigned only while the event is in progress.");
  }

  const existingSteps = await tx.registrationRouteStep.findMany({
    where: { registrationId },
    select: routeStepSelect,
    orderBy: { position: "asc" },
  });
  if (existingSteps.length) {
    const queueEntry = await tx.queueEntry.findFirst({
      where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
      orderBy: { enteredAt: "desc" },
    });
    return buildRouteState({
      routeVersion: registration.routeVersion,
      steps: existingSteps,
      queueEntry,
    });
  }

  const candidates = await loadRouteCandidates(tx, eventId, now);
  if (!candidates.length) {
    return buildRouteState({ routeVersion: registration.routeVersion, steps: [], queueEntry: null });
  }

  const [existingResults, existingQueue] = await Promise.all([
    tx.screeningResult.findMany({
      where: { registrationId },
      select: { stationId: true, updatedAt: true },
    }),
    tx.queueEntry.findFirst({
      where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
      orderBy: { enteredAt: "desc" },
    }),
  ]);
  const resultByStation = new Map(existingResults.map((result) => [result.stationId, result]));
  const candidateByStation = new Map(candidates.map((candidate) => [candidate.stationId, candidate]));
  if (existingQueue && !candidateByStation.has(existingQueue.stationId)) {
    throw new AppError(409, "ROUTE_QUEUE_CONFLICT", "The active queue is not part of the required screening route.");
  }

  const completed = candidates.filter(({ stationId }) => (
    resultByStation.has(stationId) && stationId !== existingQueue?.stationId
  ));
  const current = existingQueue ? [candidateByStation.get(existingQueue.stationId)] : [];
  const preservedIds = new Set([...completed, ...current].map(({ stationId }) => stationId));
  const orderedCandidates = [
    ...completed,
    ...current,
    ...candidates.filter(({ stationId }) => !preservedIds.has(stationId)),
  ];

  await tx.registrationRouteStep.createMany({
    data: orderedCandidates.map(({ stationId }, index) => ({
      registrationId,
      stationId,
      position: index + 1,
      completedAt: resultByStation.get(stationId)?.updatedAt || null,
    })),
  });

  const firstStation = orderedCandidates.find(({ stationId, available }) => (
    !resultByStation.has(stationId) && available
  ));
  const queueEntry = existingQueue || await createInitialQueueEntry({
    tx,
    registrationId,
    stationId: firstStation?.stationId || null,
  });
  const steps = orderedCandidates.map((candidate, index) => ({
    ...candidate,
    position: index + 1,
    completedAt: resultByStation.get(candidate.stationId)?.updatedAt || null,
  }));

  await createAuditLog({
    userId: actorUserId,
    action: "REGISTRATION_ROUTE_ASSIGNED",
    entityName: "EventRegistration",
    entityId: registrationId,
    newValue: {
      eventId,
      stationIds: orderedCandidates.map(({ stationId }) => stationId),
      initialStationId: queueEntry?.stationId || null,
      routeVersion: registration.routeVersion,
    },
    context,
    client: tx,
  });

  return buildRouteState({
    routeVersion: registration.routeVersion,
    steps,
    queueEntry,
  });
};

const lockRegistration = async (tx, registrationId) => {
  if (typeof tx.$queryRaw !== "function") return;
  const rows = await tx.$queryRaw`
    SELECT registration_id
    FROM event_registrations
    WHERE registration_id = CAST(${registrationId} AS uuid)
    FOR UPDATE
  `;
  if (!rows.length) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
};

const assignCheckedInRegistration = async (registrationId, db = prisma) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        await lockRegistration(tx, registrationId);
        const registration = await tx.eventRegistration.findUnique({
          where: { registrationId },
          select: {
            registrationId: true,
            eventId: true,
            registeredBy: true,
            checkedIn: true,
            registrationStatus: true,
            event: { select: { status: true } },
          },
        });
        if (!registration || !registration.checkedIn || registration.registrationStatus !== "CHECKED_IN") {
          throw new AppError(409, "BACKFILL_NOT_CHECKED_IN", "Only checked-in registrations can be backfilled.");
        }
        if (registration.event.status !== "IN_PROGRESS") {
          throw new AppError(409, "EVENT_NOT_IN_PROGRESS", "Routes can be assigned only while the event is in progress.");
        }
        return assignRouteOnce({
          tx,
          registrationId,
          eventId: registration.eventId,
          actorUserId: null,
        });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if ((error.code === "P2034" || error.code === "P2002") && attempt < 3) continue;
      throw error;
    }
  }
  throw new AppError(409, "ROUTE_ASSIGNMENT_CONFLICT", "Unable to assign the route. Please retry.");
};

module.exports = {
  assignCheckedInRegistration,
  assignRouteOnce,
  buildRouteState,
  getRouteState,
  loadRouteCandidates,
};
