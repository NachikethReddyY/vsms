const AppError = require("../../errors/AppError");
const { createAuditLog } = require("../../utils/logging/audit");

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];

const allocateQueueNumber = async (tx, registration) => {
  if (registration.queueNumber != null) return registration.queueNumber;

  if (typeof tx.$queryRaw === "function") {
    await tx.$queryRaw`
      SELECT event_id
      FROM events
      WHERE event_id = CAST(${registration.eventId} AS uuid)
      FOR UPDATE
    `;
  }
  const aggregate = await tx.eventRegistration.aggregate({
    where: { eventId: registration.eventId },
    _max: { queueNumber: true },
  });
  const queueNumber = (aggregate._max.queueNumber || 0) + 1;
  await tx.eventRegistration.update({
    where: { registrationId: registration.registrationId },
    data: { queueNumber },
  });
  return queueNumber;
};

/** The only route service permitted to create the first or next active queue entry. */
const createInitialQueueEntry = async ({ tx, registrationId, stationId }) => {
  if (!stationId) return null;

  const existing = await tx.queueEntry.findFirst({
    where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
    orderBy: { enteredAt: "desc" },
  });
  if (existing) {
    if (existing.stationId === stationId) return existing;
    throw new AppError(
      409,
      "ROUTE_QUEUE_CONFLICT",
      "The participant already has an active queue entry for another station.",
    );
  }

  const registration = await tx.eventRegistration.findUnique({
    where: { registrationId },
    select: {
      registrationId: true,
      eventId: true,
      queueNumber: true,
      registrationStatus: true,
    },
  });
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
  }
  if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
    throw new AppError(409, "REGISTRATION_NOT_QUEUEABLE", "Completed or cancelled registrations cannot join a queue.");
  }

  const queueNumber = await allocateQueueNumber(tx, registration);
  return tx.queueEntry.create({
    data: {
      registrationId,
      stationId,
      queueNumber,
      status: "WAITING",
    },
  });
};

const stationAvailable = (station, availability, now) => (
  station.isActive
  && station.operationalStatus !== "PAUSED"
  && station.operationalStatus !== "OFFLINE"
  && (!availability || (
    availability.isAvailable
    && (!availability.startsAt || availability.startsAt <= now)
    && (!availability.endsAt || availability.endsAt > now)
  ))
);

const safeStation = (station) => ({
  stationId: station.stationId,
  stationName: station.stationName,
  stationType: station.stationType,
});

/** Reconcile a route override without allowing the override service to write queues directly. */
const reconcileAfterRouteOverride = async ({
  tx,
  registrationId,
  eventId,
  nextStep,
  now = new Date(),
}) => {
  const activeQueue = await tx.queueEntry.findFirst({
    where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
    orderBy: { enteredAt: "desc" },
  });
  if (activeQueue) {
    if (activeQueue.stationId !== nextStep?.stationId) {
      throw new AppError(409, "ROUTE_QUEUE_CONFLICT", "The active queue does not match the current route step.");
    }
    return activeQueue;
  }
  if (!nextStep) return null;

  const availability = await tx.eventStationAvailability.findFirst({
    where: {
      eventStationId: nextStep.stationId,
      eventDay: { eventId, startsAt: { lte: now }, endsAt: { gt: now } },
    },
    select: { isAvailable: true, startsAt: true, endsAt: true },
  });
  if (!stationAvailable(nextStep.station, availability, now)) return null;

  return createInitialQueueEntry({ tx, registrationId, stationId: nextStep.stationId });
};

/** Complete the current route step and queue, then create at most one next queue entry. */
const advanceAfterFirstResult = async ({
  tx,
  registrationId,
  eventId,
  stationId,
  actorUserId,
  context = null,
  now = new Date(),
}) => {
  const [steps, activeQueue] = await Promise.all([
    tx.registrationRouteStep.findMany({
      where: { registrationId },
      orderBy: { position: "asc" },
      include: {
        station: {
          select: {
            stationId: true,
            stationName: true,
            stationType: true,
            isActive: true,
            operationalStatus: true,
          },
        },
      },
    }),
    tx.queueEntry.findFirst({
      where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
      orderBy: { enteredAt: "desc" },
    }),
  ]);

  if (!steps.length) {
    throw new AppError(409, "ROUTE_NOT_ASSIGNED", "The participant does not have an assigned screening route.");
  }
  const currentStep = steps.find((step) => step.stationId === stationId);
  if (!currentStep || currentStep.completedAt) {
    throw new AppError(409, "ROUTE_STATION_MISMATCH", "Results can advance only the current unfinished route station.");
  }
  const firstUnfinished = steps.find((step) => !step.completedAt);
  if (firstUnfinished?.routeStepId !== currentStep.routeStepId || activeQueue?.stationId !== stationId) {
    throw new AppError(409, "ROUTE_STATION_MISMATCH", "Results can advance only the participant's active route station.");
  }

  const completedQueue = await tx.queueEntry.updateMany({
    where: { id: activeQueue.id, registrationId, stationId, status: { in: ACTIVE_QUEUE_STATUSES } },
    data: { status: "COMPLETED", completedAt: now, leftQueueAt: now },
  });
  const completedStep = await tx.registrationRouteStep.updateMany({
    where: { routeStepId: currentStep.routeStepId, registrationId, completedAt: null },
    data: { completedAt: now },
  });
  if (completedQueue.count !== 1 || completedStep.count !== 1) {
    throw new AppError(409, "ROUTE_PROGRESSION_CONFLICT", "The route changed while the result was being saved.");
  }

  const nextStep = steps.find((step) => step.position > currentStep.position && !step.completedAt);
  let nextQueue = null;
  let status = "REVIEW_READY";
  if (nextStep) {
    const availability = await tx.eventStationAvailability.findFirst({
      where: {
        eventStationId: nextStep.stationId,
        eventDay: { eventId, startsAt: { lte: now }, endsAt: { gt: now } },
      },
      select: { isAvailable: true, startsAt: true, endsAt: true },
    });
    if (stationAvailable(nextStep.station, availability, now)) {
      nextQueue = await createInitialQueueEntry({ tx, registrationId, stationId: nextStep.stationId });
      await tx.queueMovement.create({
        data: {
          registrationId,
          fromStationId: stationId,
          toStationId: nextStep.stationId,
          movedBy: actorUserId,
          movementReason: "AUTOMATIC_ROUTE_PROGRESSION",
        },
      });
      status = "ADDED_TO_QUEUE";
    } else {
      status = "BLOCKED";
    }
  }

  const version = await tx.eventRegistration.update({
    where: { registrationId },
    data: { routeVersion: { increment: 1 } },
    select: { routeVersion: true },
  });
  const routeProgression = {
    status,
    routeVersion: version.routeVersion,
    completedStation: safeStation(currentStep.station),
    nextStation: nextStep ? safeStation(nextStep.station) : null,
    nextQueue: nextQueue ? {
      stationId: nextQueue.stationId,
      stationName: nextStep.station.stationName,
      stationType: nextStep.station.stationType,
      queueNumber: nextQueue.queueNumber,
      status: nextQueue.status,
    } : null,
  };

  await createAuditLog({
    userId: actorUserId,
    action: "REGISTRATION_ROUTE_PROGRESSED",
    entityName: "EventRegistration",
    entityId: registrationId,
    oldValue: { stationId, queueStatus: activeQueue.status },
    newValue: {
      status,
      completedStationId: stationId,
      nextStationId: nextStep?.stationId || null,
      routeVersion: version.routeVersion,
    },
    context,
    client: tx,
  });

  return { routeProgression, completedQueueEntryId: activeQueue.id };
};

module.exports = {
  ACTIVE_QUEUE_STATUSES,
  advanceAfterFirstResult,
  createInitialQueueEntry,
  reconcileAfterRouteOverride,
};
