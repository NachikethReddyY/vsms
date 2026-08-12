const { createAuditLog } = require("../../utils/logging/audit");
const AppError = require("../../errors/AppError");

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];
const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "CONFIRMED"];

const serializeStation = (station, metrics = {}) => ({
  stationId: station.stationId,
  stationName: station.stationName,
  stationType: station.stationType,
  stationOrder: station.stationOrder,
  operationalStatus: station.operationalStatus,
  waitingCount: metrics.waitingCount || 0,
  currentWorkload: metrics.currentWorkload || 0,
  activeStaffCount: metrics.activeStaffCount || 0,
});

const serializeEntry = (entry) => entry ? ({
  id: entry.id,
  registrationId: entry.registrationId,
  stationId: entry.stationId,
  stationName: entry.station?.stationName || null,
  stationType: entry.station?.stationType || null,
  queueNumber: entry.queueNumber,
  status: entry.status,
  enteredAt: entry.enteredAt,
  calledAt: entry.calledAt,
  startedAt: entry.startedAt,
}) : null;

const findActiveEntry = (tx, registrationId) => tx.queueEntry.findFirst({
  where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
  orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
  include: {
    station: {
      select: {
        stationId: true,
        stationName: true,
        stationType: true,
        stationOrder: true,
      },
    },
  },
});

const ensureQueueNumber = async (tx, registration) => {
  if (registration.queueNumber != null) return registration.queueNumber;
  const aggregate = await tx.eventRegistration.aggregate({
    where: { eventId: registration.eventId },
    _max: { queueNumber: true },
  });
  const queueNumber = (aggregate._max.queueNumber || 0) + 1;
  await tx.eventRegistration.update({
    where: { registrationId: registration.registrationId },
    data: { queueNumber },
  });
  registration.queueNumber = queueNumber;
  return queueNumber;
};

/**
 * Resolve the ordered required station list for an event. Prefers the
 * configured Event.screeningRoute; falls back to the active stations ordered
 * by stationOrder.
 */
const getRequiredStations = async (db, eventId) => {
  const [event, activeStations] = await Promise.all([
    db.event.findUnique({
      where: { eventId },
      select: { eventId: true, screeningRoute: true },
    }),
    db.station.findMany({
      where: { eventId, isActive: true },
      orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }],
      select: {
        stationId: true,
        stationName: true,
        stationType: true,
        stationOrder: true,
        operationalStatus: true,
      },
    }),
  ]);

  if (!event) {
    throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  }

  const byType = new Map(activeStations.map((station) => [station.stationType, station]));
  const configured =
    Array.isArray(event.screeningRoute) && event.screeningRoute.length > 0
      ? event.screeningRoute
          .map((stationType) => byType.get(stationType))
          .filter(Boolean)
      : [];

  return configured.length > 0 ? configured : activeStations;
};

/** Station types the participant has already been screened for. */
const getCompletedStationTypes = async (db, registrationId) => {
  const results = await db.screeningResult.findMany({
    where: { registrationId },
    select: { screeningType: true },
  });
  return results.map((row) => row.screeningType);
};

/** Station types explicitly waived for the participant via a SKIPPED entry. */
const getWaivedStationTypes = async (db, registrationId) => {
  const entries = await db.queueEntry.findMany({
    where: { registrationId, status: "SKIPPED" },
    select: { station: { select: { stationType: true } } },
  });
  return entries
    .map((entry) => entry.station?.stationType)
    .filter(Boolean);
};

/** Required stations minus completed minus waived. Exclusions only affect this selection. */
const getRemainingRequiredStations = async (db, eventId, registrationId, { excludeStationTypes = [] } = {}) => {
  const [required, completed, waived] = await Promise.all([
    getRequiredStations(db, eventId),
    getCompletedStationTypes(db, registrationId),
    getWaivedStationTypes(db, registrationId),
  ]);
  const done = new Set([...completed, ...waived]);
  const remaining = required.filter((station) => !done.has(station.stationType));
  return {
    remaining,
    candidates: remaining.filter((station) => !excludeStationTypes.includes(station.stationType)),
  };
};

/**
 * Choose the least-loaded staffed station that the participant has not
 * completed or waived. The score deliberately favours short waiting lines,
 * then current work per screener.
 */
const selectNextStation = async (tx, { eventId, registrationId, excludeStationTypes = [], now = new Date() }) => {
  const [stations, completedResults, activeEntries] = await Promise.all([
    tx.station.findMany({
      where: { eventId, isActive: true },
      orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }],
      include: {
        staffAssignments: {
          where: {
            assignmentRole: "SCREENER",
            assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES },
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            OR: [
              { shiftId: null },
              {
                shift: {
                  eventId,
                  status: "ACTIVE",
                  startsAt: { lte: now },
                  endsAt: { gt: now },
                },
              },
            ],
          },
          select: { id: true },
        },
      },
    }),
    tx.screeningResult.findMany({
      where: { registrationId },
      select: { stationId: true },
    }),
    tx.queueEntry.findMany({
      where: {
        station: { eventId },
        status: { in: ACTIVE_QUEUE_STATUSES },
      },
      select: { stationId: true, status: true },
    }),
  ]);

  const required = await getRequiredStations(tx, eventId);
  const byId = new Map(stations.map((station) => [station.stationId, station]));
  const completedStationIds = new Set(completedResults.map(({ stationId }) => stationId));

  const waivedEntries = await tx.queueEntry.findMany({
    where: { registrationId, status: "SKIPPED" },
    select: { station: { select: { stationType: true } } },
  });
  const waivedTypes = new Set(
    waivedEntries.map((entry) => entry.station?.stationType).filter(Boolean),
  );

  const remainingRequired = required
    .map((station) => ({ ...station, ...byId.get(station.stationId) }))
    .filter((station) => (
      station.stationId
      && !completedStationIds.has(station.stationId)
      && !waivedTypes.has(station.stationType)
    ));
  const candidates = remainingRequired.filter(
    (station) => !excludeStationTypes.includes(station.stationType),
  );

  const workload = new Map();
  for (const entry of activeEntries) {
    const counts = workload.get(entry.stationId) || { waitingCount: 0, currentWorkload: 0 };
    if (entry.status === "WAITING") counts.waitingCount += 1;
    else counts.currentWorkload += 1;
    workload.set(entry.stationId, counts);
  }

  const selectable = candidates
    .filter((station) => station.operationalStatus === "AVAILABLE" && station.staffAssignments.length > 0)
    .map((station) => {
      const counts = workload.get(station.stationId) || { waitingCount: 0, currentWorkload: 0 };
      const metrics = {
        ...counts,
        activeStaffCount: station.staffAssignments.length,
      };
      return {
        station,
        metrics,
        score: (counts.waitingCount * 2 + counts.currentWorkload * 3) / metrics.activeStaffCount,
      };
    })
    .sort((a, b) => a.score - b.score
      || a.metrics.waitingCount - b.metrics.waitingCount
      || a.station.stationOrder - b.station.stationOrder
      || a.station.stationId.localeCompare(b.station.stationId));

  const selected = selectable[0] || null;
  return {
    selected: selected ? serializeStation(selected.station, selected.metrics) : null,
    remainingStationCount: remainingRequired.length,
    unavailableStations: selected ? [] : candidates.map((station) => serializeStation(station, {
      ...(workload.get(station.stationId) || {}),
      activeStaffCount: station.staffAssignments?.length || 0,
    })),
  };
};

const journeyResponse = ({ state, registration, activeEntry = null, assignedStation = null, created = false, remainingStationCount = 0 }) => ({
  state,
  registrationId: registration.registrationId,
  registrationStatus: registration.registrationStatus,
  queueNumber: activeEntry?.queueNumber ?? registration.queueNumber ?? null,
  activeEntry: serializeEntry(activeEntry),
  assignedStation,
  created,
  remainingStationCount,
});

const ensureActiveQueue = async (tx, { registration, userId, context = null }) => {
  const existing = await findActiveEntry(tx, registration.registrationId);
  if (existing) {
    const { remaining } = await getRemainingRequiredStations(
      tx,
      registration.eventId,
      registration.registrationId,
    );
    return journeyResponse({
      state: "QUEUED",
      registration,
      activeEntry: existing,
      assignedStation: existing.station ? serializeStation(existing.station) : null,
      remainingStationCount: remaining.length,
    });
  }

  const selection = await selectNextStation(tx, {
    eventId: registration.eventId,
    registrationId: registration.registrationId,
  });

  if (selection.remainingStationCount === 0) {
    return journeyResponse({ state: "COMPLETED", registration, remainingStationCount: 0 });
  }
  if (!selection.selected) {
    return journeyResponse({
      state: "AWAITING_STATION",
      registration,
      remainingStationCount: selection.remainingStationCount,
    });
  }

  const queueNumber = await ensureQueueNumber(tx, registration);
  const entry = await tx.queueEntry.create({
    data: {
      registrationId: registration.registrationId,
      stationId: selection.selected.stationId,
      queueNumber,
      status: "WAITING",
    },
    include: {
      station: { select: { stationId: true, stationName: true, stationType: true, stationOrder: true } },
    },
  });

  await createAuditLog({
    userId,
    action: "QUEUE_AUTO_ASSIGNED",
    entityName: "QueueEntry",
    entityId: entry.id,
    newValue: {
      eventId: registration.eventId,
      registrationId: registration.registrationId,
      stationId: selection.selected.stationId,
      queueNumber,
      assignmentBasis: {
        waitingCount: selection.selected.waitingCount,
        currentWorkload: selection.selected.currentWorkload,
        activeStaffCount: selection.selected.activeStaffCount,
      },
    },
    context,
    client: tx,
  });

  return journeyResponse({
    state: "QUEUED",
    registration,
    activeEntry: entry,
    assignedStation: selection.selected,
    created: true,
    remainingStationCount: selection.remainingStationCount,
  });
};

const getCurrentJourney = async (tx, registration) => {
  const activeEntry = await findActiveEntry(tx, registration.registrationId);
  if (activeEntry) {
    const { remaining } = await getRemainingRequiredStations(
      tx,
      registration.eventId,
      registration.registrationId,
    );
    return journeyResponse({
      state: "QUEUED",
      registration,
      activeEntry,
      assignedStation: activeEntry.station ? serializeStation(activeEntry.station) : null,
      remainingStationCount: remaining.length,
    });
  }
  const { remaining } = await getRemainingRequiredStations(
    tx,
    registration.eventId,
    registration.registrationId,
  );
  return journeyResponse({
    state: registration.registrationStatus === "COMPLETED" ? "COMPLETED" : "AWAITING_STATION",
    registration,
    remainingStationCount: remaining.length,
  });
};

const completeStationAndAssignNext = async (tx, {
  registration,
  stationId,
  resultId = null,
  userId,
  context = null,
  excludeStationTypes = [],
}) => {
  const activeEntry = await findActiveEntry(tx, registration.registrationId);
  if (activeEntry && activeEntry.stationId !== stationId) {
    throw new AppError(409, "QUEUE_STATION_MISMATCH", "Participant is assigned to a different station", {
      assignedStationId: activeEntry.stationId,
      submittedStationId: stationId,
    });
  }

  let completedEntry = null;
  if (activeEntry) {
    const now = new Date();
    completedEntry = await tx.queueEntry.update({
      where: { id: activeEntry.id },
      data: {
        status: "COMPLETED",
        startedAt: activeEntry.startedAt || now,
        completedAt: now,
        leftQueueAt: now,
      },
    });
    if (resultId) {
      await tx.screeningResult.update({
        where: { resultId },
        data: { queueEntryId: activeEntry.id },
      });
    }
  }

  const stationType = activeEntry?.station?.stationType || null;
  const selection = await selectNextStation(tx, {
    eventId: registration.eventId,
    registrationId: registration.registrationId,
    excludeStationTypes: excludeStationTypes.length
      ? excludeStationTypes
      : (stationType ? [stationType] : []),
  });

  if (selection.remainingStationCount === 0) {
    if (registration.registrationStatus !== "COMPLETED") {
      await tx.eventRegistration.update({
        where: { registrationId: registration.registrationId },
        data: { registrationStatus: "COMPLETED" },
      });
      await tx.registrationStatusHistory.create({
        data: {
          registrationId: registration.registrationId,
          fromStatus: registration.registrationStatus,
          toStatus: "COMPLETED",
          changedById: userId,
          reason: "All required screening stations completed",
        },
      });
      registration.registrationStatus = "COMPLETED";
    }
    await createAuditLog({
      userId,
      action: "QUEUE_JOURNEY_COMPLETED",
      entityName: "EventRegistration",
      entityId: registration.registrationId,
      newValue: { stationId, resultId, registrationStatus: "COMPLETED" },
      context,
      client: tx,
    });
    return journeyResponse({ state: "COMPLETED", registration });
  }

  if (!selection.selected) {
    await createAuditLog({
      userId,
      action: "QUEUE_AWAITING_STATION",
      entityName: "EventRegistration",
      entityId: registration.registrationId,
      newValue: { stationId, resultId, remainingStationCount: selection.remainingStationCount },
      context,
      client: tx,
    });
    return journeyResponse({
      state: "AWAITING_STATION",
      registration,
      remainingStationCount: selection.remainingStationCount,
    });
  }

  const queueNumber = await ensureQueueNumber(tx, registration);
  const nextEntry = await tx.queueEntry.create({
    data: {
      registrationId: registration.registrationId,
      stationId: selection.selected.stationId,
      queueNumber,
      status: "WAITING",
      isPriority: completedEntry?.isPriority || false,
      priorityNotes: completedEntry?.priorityNotes || null,
    },
    include: {
      station: { select: { stationId: true, stationName: true, stationType: true, stationOrder: true } },
    },
  });
  await tx.queueMovement.create({
    data: {
      registrationId: registration.registrationId,
      fromStationId: stationId,
      toStationId: selection.selected.stationId,
      movedBy: userId,
      movementReason: "AUTO_ROUTED",
    },
  });
  await createAuditLog({
    userId,
    action: "QUEUE_AUTO_ADVANCED",
    entityName: "QueueEntry",
    entityId: nextEntry.id,
    oldValue: { queueEntryId: completedEntry?.id || null, stationId },
    newValue: {
      stationId: selection.selected.stationId,
      queueNumber,
      assignmentBasis: {
        waitingCount: selection.selected.waitingCount,
        currentWorkload: selection.selected.currentWorkload,
        activeStaffCount: selection.selected.activeStaffCount,
      },
    },
    context,
    client: tx,
  });
  return journeyResponse({
    state: "QUEUED",
    registration,
    activeEntry: nextEntry,
    assignedStation: selection.selected,
    created: true,
    remainingStationCount: selection.remainingStationCount,
  });
};

module.exports = {
  ACTIVE_QUEUE_STATUSES,
  completeStationAndAssignNext,
  ensureActiveQueue,
  findActiveEntry,
  getCurrentJourney,
  getRequiredStations,
  getCompletedStationTypes,
  getWaivedStationTypes,
  getRemainingRequiredStations,
  selectNextStation,
};
