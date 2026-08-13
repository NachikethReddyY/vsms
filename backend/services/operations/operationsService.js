const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const {
  assertOperationalAccount,
  eventVisibilityWhere,
  isAdministrator,
} = require("../event/eventAuthorizationService");
const { attended } = require("../event/attendanceDefinition");

const ACTIVE_ASSIGNMENT_STATUSES = new Set(["ASSIGNED", "CONFIRMED"]);
const ACTIVE_QUEUE_STATUSES = new Set(["WAITING", "CALLED", "IN_PROGRESS"]);
const EVENT_STATUS_FILTERS = {
  ACTIVE: ["IN_PROGRESS"],
  UPCOMING: ["DRAFT", "PUBLISHED"],
  COMPLETED: ["COMPLETED", "CANCELLED"],
};
const SEVERITY_ORDER = { critical: 0, warning: 1, normal: 2 };

const emptyProgress = () => ({
  total: 0,
  signedUp: 0,
  checkedIn: 0,
  completed: 0,
  screened: 0,
  reviewed: 0,
});

const emptyQueue = () => ({
  waiting: 0,
  called: 0,
  inProgress: 0,
  completed: 0,
  skipped: 0,
  priority: 0,
  longestWaitMinutes: 0,
});

const hasActiveAssignmentState = (assignment) => {
  const states = [assignment.status, assignment.assignmentStatus].filter(Boolean);
  return states.length > 0 && states.every((state) => ACTIVE_ASSIGNMENT_STATUSES.has(state));
};

const operationalShiftFor = (event, now) => {
  const shifts = event.shifts || [];
  if (!shifts.length) return null;
  const containingNow = shifts.find((shift) => (
    new Date(shift.startsAt).getTime() <= now.getTime()
    && new Date(shift.endsAt).getTime() > now.getTime()
  ));
  if (event.status === "IN_PROGRESS") {
    return shifts.find((shift) => (
      shift.status === "ACTIVE"
      && new Date(shift.startsAt).getTime() <= now.getTime()
      && new Date(shift.endsAt).getTime() > now.getTime()
    ))
      || shifts.find((shift) => shift.status === "ACTIVE")
      || containingNow
      || shifts.find((shift) => new Date(shift.endsAt).getTime() > now.getTime())
      || shifts.at(-1);
  }
  if (["DRAFT", "PUBLISHED"].includes(event.status)) {
    return shifts.find((shift) => new Date(shift.endsAt).getTime() > now.getTime()) || shifts.at(-1);
  }
  return shifts.at(-1);
};

const statusWhere = (status) => status === "ALL" ? {} : { status: { in: EVENT_STATUS_FILTERS[status] } };

const buildAttention = ({ event, stationSummary, staffing, queue, referrals, sync }) => {
  const reasons = [];
  const add = (code, label, count, severity) => {
    if (count > 0) reasons.push({ code, label, count, severity });
  };

  add("STATIONS_OFFLINE", "Offline stations", stationSummary.offline, "critical");
  add("SYNC_ISSUES", "Sync issues", sync.issues, "critical");
  add("STATIONS_PAUSED", "Paused stations", stationSummary.paused, "warning");
  if (["PUBLISHED", "IN_PROGRESS"].includes(event.status)) {
    add("STATIONS_UNSTAFFED", "Unstaffed stations", staffing.unstaffedStations, "warning");
    if (queue.waiting > 0 && staffing.assigned === 0) {
      add("QUEUE_WITHOUT_STAFF", "Queue has no active staff", queue.waiting, "critical");
    }
  }
  add("PRIORITY_WAITING", "Priority participants waiting", queue.priority, "warning");
  add("REFERRALS_ACTION_REQUIRED", "Referrals require action", referrals.actionRequired, "warning");

  return {
    severity: reasons.some(({ severity }) => severity === "critical")
      ? "critical"
      : reasons.length ? "warning" : "normal",
    reasons,
  };
};

const getOverview = async (query, user, db = prisma, now = new Date()) => {
  assertOperationalAccount(user);
  if (!isAdministrator(user)) {
    const managerMembership = await db.eventMembership.findFirst({
      where: {
        userId: user.userId,
        status: "ACTIVE",
        roles: { some: { role: "EVENT_MANAGER" } },
      },
      select: { id: true },
    });
    if (!managerMembership) {
      throw new AppError(403, "OPERATIONS_FORBIDDEN", "An EVENT_MANAGER membership is required for the Operations Center");
    }
  }

  const visibility = eventVisibilityWhere(user, ["EVENT_MANAGER"]);
  const conditions = [visibility, statusWhere(query.status)];
  if (query.search) {
    conditions.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { venue: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }
  const where = { AND: conditions.filter((condition) => Object.keys(condition).length > 0) };

  const rows = await db.event.findMany({
    where,
    select: {
      eventId: true,
      name: true,
      status: true,
      venue: true,
      timezone: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      stations: {
        orderBy: [{ stationOrder: "asc" }, { stationId: "asc" }],
        select: {
          stationId: true,
          stationName: true,
          stationType: true,
          stationOrder: true,
          isActive: true,
          operationalStatus: true,
        },
      },
      shifts: {
        orderBy: [{ startsAt: "asc" }, { shiftId: "asc" }],
        select: {
          shiftId: true,
          name: true,
          startsAt: true,
          endsAt: true,
          requiredStaff: true,
          status: true,
          staffAssignments: {
            select: {
              id: true,
              userId: true,
              stationId: true,
              assignmentRole: true,
              assignmentStatus: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: [{ startsAt: "asc" }, { eventId: "asc" }],
    take: query.limit + 1,
  });

  const truncated = rows.length > query.limit;
  const events = truncated ? rows.slice(0, query.limit) : rows;
  const eventIds = events.map(({ eventId }) => eventId);
  if (!eventIds.length) {
    return {
      generatedAt: now.toISOString(),
      filters: { status: query.status, search: query.search || null },
      summary: {
        events: { total: 0, active: 0, upcoming: 0, completed: 0, needsAttention: 0 },
        participants: { checkedIn: 0, completed: 0 },
        queue: { waiting: 0, active: 0 },
      },
      events: [],
      truncated,
    };
  }

  const [registrations, queueEntries, screeningResults, reviews, referrals] = await Promise.all([
    db.eventRegistration.findMany({
      where: { eventId: { in: eventIds } },
      select: {
        registrationId: true,
        eventId: true,
        registrationStatus: true,
        checkedIn: true,
        checkedInAt: true,
      },
    }),
    db.queueEntry.findMany({
      where: { registration: { eventId: { in: eventIds } } },
      select: {
        id: true,
        stationId: true,
        status: true,
        isPriority: true,
        enteredAt: true,
        registration: { select: { eventId: true } },
      },
    }),
    db.screeningResult.findMany({
      where: { registration: { eventId: { in: eventIds } } },
      select: { resultId: true, registrationId: true, registration: { select: { eventId: true } } },
    }),
    db.review.findMany({
      where: { registration: { eventId: { in: eventIds } } },
      select: { reviewId: true, registrationId: true, registration: { select: { eventId: true } } },
    }),
    db.referral.findMany({
      where: { review: { registration: { eventId: { in: eventIds } } } },
      select: {
        referralId: true,
        status: true,
        review: { select: { registration: { select: { eventId: true } } } },
      },
    }),
  ]);

  const entityEvent = new Map(eventIds.map((eventId) => [eventId, eventId]));
  for (const row of registrations) entityEvent.set(row.registrationId, row.eventId);
  for (const row of queueEntries) entityEvent.set(row.id, row.registration.eventId);
  for (const row of screeningResults) entityEvent.set(row.resultId, row.registration.eventId);
  for (const row of reviews) entityEvent.set(row.reviewId, row.registration.eventId);
  for (const row of referrals) entityEvent.set(row.referralId, row.review.registration.eventId);

  const syncRows = await db.syncAction.findMany({
    where: {
      OR: [
        { eventId: { in: eventIds } },
        { entityId: { in: [...entityEvent.keys()] } },
      ],
      status: { in: ["PENDING", "PROCESSING", "CONFLICT", "FAILED"] },
    },
    select: { eventId: true, entityId: true, status: true },
  });

  const byEvent = new Map(events.map((event) => [event.eventId, {
    progress: emptyProgress(),
    queue: emptyQueue(),
    screenedRegistrations: new Set(),
    reviewedRegistrations: new Set(),
    referrals: { actionRequired: 0 },
    sync: { pending: 0, issues: 0 },
    queueByStation: new Map(),
  }]));

  for (const row of registrations) {
    const aggregate = byEvent.get(row.eventId);
    if (!aggregate || row.registrationStatus === "CANCELLED") continue;
    aggregate.progress.total += 1;
    if (row.registrationStatus === "SIGNED_UP") aggregate.progress.signedUp += 1;
    if (attended(row)) aggregate.progress.checkedIn += 1;
    if (row.registrationStatus === "COMPLETED") aggregate.progress.completed += 1;
  }

  for (const row of queueEntries) {
    const aggregate = byEvent.get(row.registration.eventId);
    if (!aggregate) continue;
    const station = aggregate.queueByStation.get(row.stationId) || { waiting: 0, active: 0 };
    if (row.status === "WAITING") {
      aggregate.queue.waiting += 1;
      station.waiting += 1;
      aggregate.queue.longestWaitMinutes = Math.max(
        aggregate.queue.longestWaitMinutes,
        Math.max(0, Math.floor((now.getTime() - new Date(row.enteredAt).getTime()) / 60000)),
      );
    } else if (row.status === "CALLED") {
      aggregate.queue.called += 1;
      station.active += 1;
    } else if (row.status === "IN_PROGRESS") {
      aggregate.queue.inProgress += 1;
      station.active += 1;
    } else if (row.status === "COMPLETED") aggregate.queue.completed += 1;
    else if (row.status === "SKIPPED") aggregate.queue.skipped += 1;
    if (row.isPriority && ACTIVE_QUEUE_STATUSES.has(row.status)) aggregate.queue.priority += 1;
    aggregate.queueByStation.set(row.stationId, station);
  }

  for (const row of screeningResults) {
    byEvent.get(row.registration.eventId)?.screenedRegistrations.add(row.registrationId);
  }
  for (const row of reviews) {
    byEvent.get(row.registration.eventId)?.reviewedRegistrations.add(row.registrationId);
  }
  for (const row of referrals) {
    if (["DRAFT", "ISSUED"].includes(row.status)) {
      const aggregate = byEvent.get(row.review.registration.eventId);
      if (aggregate) aggregate.referrals.actionRequired += 1;
    }
  }
  for (const row of syncRows) {
    const eventId = row.eventId || entityEvent.get(row.entityId);
    const aggregate = byEvent.get(eventId);
    if (!aggregate) continue;
    if (["PENDING", "PROCESSING"].includes(row.status)) aggregate.sync.pending += 1;
    else aggregate.sync.issues += 1;
  }

  const operationEvents = events.map((event) => {
    const aggregate = byEvent.get(event.eventId);
    aggregate.progress.screened = aggregate.screenedRegistrations.size;
    aggregate.progress.reviewed = aggregate.reviewedRegistrations.size;
    const shift = operationalShiftFor(event, now);
    const assignments = (shift?.staffAssignments || []).filter(hasActiveAssignmentState);
    const assignedUsers = new Set(assignments.map(({ userId }) => userId));
    const staffedStations = new Set(assignments
      .filter(({ assignmentRole, stationId }) => assignmentRole === "SCREENER" && stationId)
      .map(({ stationId }) => stationId));
    const activeStations = event.stations.filter(({ isActive }) => isActive);
    const stationItems = activeStations.map((station) => {
      const workload = aggregate.queueByStation.get(station.stationId) || { waiting: 0, active: 0 };
      return {
        stationId: station.stationId,
        name: station.stationName,
        type: station.stationType,
        order: station.stationOrder,
        operationalStatus: station.operationalStatus,
        staffed: staffedStations.has(station.stationId),
        queue: workload,
      };
    });
    const stationSummary = {
      total: activeStations.length,
      available: activeStations.filter(({ operationalStatus }) => operationalStatus === "AVAILABLE").length,
      paused: activeStations.filter(({ operationalStatus }) => operationalStatus === "PAUSED").length,
      offline: activeStations.filter(({ operationalStatus }) => operationalStatus === "OFFLINE").length,
    };
    const staffing = {
      shiftId: shift?.shiftId || null,
      shiftName: shift?.name || null,
      startsAt: shift?.startsAt || null,
      endsAt: shift?.endsAt || null,
      required: shift?.requiredStaff || 0,
      assigned: assignedUsers.size,
      unfilled: Math.max(0, (shift?.requiredStaff || 0) - assignedUsers.size),
      unstaffedStations: stationItems.filter((station) => (
        station.operationalStatus === "AVAILABLE" && !station.staffed
      )).length,
    };
    const attention = buildAttention({
      event,
      stationSummary,
      staffing,
      queue: aggregate.queue,
      referrals: aggregate.referrals,
      sync: aggregate.sync,
    });

    return {
      eventId: event.eventId,
      name: event.name,
      status: event.status,
      venue: event.venue,
      timezone: event.timezone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      capacity: event.capacity,
      progress: aggregate.progress,
      queue: aggregate.queue,
      stations: { ...stationSummary, items: stationItems },
      staffing,
      referrals: aggregate.referrals,
      sync: aggregate.sync,
      attention,
    };
  }).sort((left, right) => (
    SEVERITY_ORDER[left.attention.severity] - SEVERITY_ORDER[right.attention.severity]
    || (left.status === "IN_PROGRESS" ? -1 : 0) - (right.status === "IN_PROGRESS" ? -1 : 0)
    || new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  ));

  const summary = operationEvents.reduce((result, event) => {
    result.events.total += 1;
    if (event.status === "IN_PROGRESS") result.events.active += 1;
    else if (["DRAFT", "PUBLISHED"].includes(event.status)) result.events.upcoming += 1;
    else result.events.completed += 1;
    if (event.attention.severity !== "normal") result.events.needsAttention += 1;
    result.participants.checkedIn += event.progress.checkedIn;
    result.participants.completed += event.progress.completed;
    result.queue.waiting += event.queue.waiting;
    result.queue.active += event.queue.called + event.queue.inProgress;
    return result;
  }, {
    events: { total: 0, active: 0, upcoming: 0, completed: 0, needsAttention: 0 },
    participants: { checkedIn: 0, completed: 0 },
    queue: { waiting: 0, active: 0 },
  });

  return {
    generatedAt: now.toISOString(),
    filters: { status: query.status, search: query.search || null },
    summary,
    events: operationEvents,
    truncated,
  };
};

module.exports = {
  getOverview,
  hasActiveAssignmentState,
  operationalShiftFor,
};
