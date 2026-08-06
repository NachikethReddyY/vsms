const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { assertOperationalAccount, requireEventManager } = require("./eventAuthorizationService");

const EVENT_LIMIT = 100;

const dayString = (date) => date.toISOString().slice(0, 10);

const reportRange = (query, now = new Date()) => {
  const fromDefault = new Date(now);
  fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
  const toDefault = new Date(now);
  toDefault.setUTCDate(toDefault.getUTCDate() + 30);
  const from = query.from || dayString(fromDefault);
  const to = query.to || dayString(toDefault);
  const startsAt = new Date(`${from}T00:00:00.000Z`);
  const endsBefore = new Date(`${to}T00:00:00.000Z`);
  endsBefore.setUTCDate(endsBefore.getUTCDate() + 1);
  return { from, to, startsAt, endsBefore };
};

const reportVisibility = (user) => {
  return {
    memberships: { some: { userId: user.userId, status: "ACTIVE", roles: { some: { role: "EVENT_MANAGER" } } } },
  };
};

const emptyEventMetrics = (event) => ({
  eventId: event.eventId,
  name: event.name,
  status: event.status,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  timezone: event.timezone,
  registrations: { total: 0, signedUp: 0, checkedIn: 0, completed: 0, cancelled: 0, completionRate: 0 },
  queue: { waiting: 0, active: 0, completed: 0, skipped: 0, cancelled: 0 },
  referrals: { total: 0, actionRequired: 0, sentOrAcknowledged: 0, cancelled: 0 },
  deliveries: { inFlight: 0, delivered: 0, issues: 0 },
  sync: { total: 0, pending: 0, applied: 0, issues: 0 },
});

const increment = (target, key) => { target[key] = (target[key] || 0) + 1; };

const finalizeEvent = (event) => {
  const total = event.registrations.total;
  event.registrations.completionRate = total
    ? Math.round((event.registrations.completed / total) * 1000) / 10
    : 0;
  return event;
};

const totalMetrics = (events) => {
  const summary = {
    events: events.length,
    registrations: { total: 0, checkedIn: 0, completed: 0, completionRate: 0 },
    queue: { waiting: 0, active: 0, completed: 0 },
    referrals: { total: 0, actionRequired: 0, sentOrAcknowledged: 0 },
    deliveries: { inFlight: 0, delivered: 0, issues: 0 },
    sync: { total: 0, pending: 0, applied: 0, issues: 0 },
  };
  for (const event of events) {
    for (const key of ["total", "checkedIn", "completed"]) summary.registrations[key] += event.registrations[key];
    for (const key of ["waiting", "active", "completed"]) summary.queue[key] += event.queue[key];
    for (const key of ["total", "actionRequired", "sentOrAcknowledged"]) summary.referrals[key] += event.referrals[key];
    for (const key of ["inFlight", "delivered", "issues"]) summary.deliveries[key] += event.deliveries[key];
    for (const key of ["total", "pending", "applied", "issues"]) summary.sync[key] += event.sync[key];
  }
  summary.registrations.completionRate = summary.registrations.total
    ? Math.round((summary.registrations.completed / summary.registrations.total) * 1000) / 10
    : 0;
  return summary;
};

const getOperationalReport = async (query, user, db = prisma, now = new Date()) => {
  assertOperationalAccount(user);
  if (query.eventId) {
    await requireEventManager(query.eventId, user, { db });
  } else {
    const managerMembership = await db.eventMembership.findFirst({
      where: { userId: user.userId, status: "ACTIVE", roles: { some: { role: "EVENT_MANAGER" } } },
      select: { id: true },
    });
    if (!managerMembership) throw new AppError(403, "REPORT_FORBIDDEN", "An EVENT_MANAGER membership is required for event reports");
  }
  const visibility = reportVisibility(user);
  const range = reportRange(query, now);
  const reportWhere = {
    ...visibility,
    ...(query.eventId ? { eventId: query.eventId } : {}),
    startsAt: { lt: range.endsBefore },
    endsAt: { gte: range.startsAt },
  };
  const optionWhere = visibility;

  const [eventCount, events, eventOptionCount, eventOptions] = await Promise.all([
    db.event.count({ where: reportWhere }),
    db.event.findMany({
      where: reportWhere,
      select: { eventId: true, name: true, status: true, startsAt: true, endsAt: true, timezone: true },
      orderBy: [{ startsAt: "desc" }, { eventId: "desc" }],
      take: EVENT_LIMIT,
    }),
    db.event.count({ where: optionWhere }),
    db.event.findMany({
      where: optionWhere,
      select: { eventId: true, name: true, status: true, startsAt: true },
      orderBy: [{ startsAt: "desc" }, { eventId: "desc" }],
      take: EVENT_LIMIT,
    }),
  ]);

  const eventIds = events.map(({ eventId }) => eventId);
  if (eventIds.length === 0) {
    return {
      filters: { eventId: query.eventId || null, from: range.from, to: range.to },
      summary: totalMetrics([]),
      events: [],
      eventOptions,
      truncated: eventCount > EVENT_LIMIT,
      eventOptionsTruncated: eventOptionCount > EVENT_LIMIT,
    };
  }

  const [registrations, queueEntries, referrals, deliveries, screeningResults, reviews] = await Promise.all([
    db.eventRegistration.findMany({
      where: { eventId: { in: eventIds } },
      select: { registrationId: true, eventId: true, registrationStatus: true },
    }),
    db.queueEntry.findMany({
      where: { registration: { eventId: { in: eventIds } } },
      select: { id: true, status: true, registration: { select: { eventId: true } } },
    }),
    db.referral.findMany({
      where: { review: { registration: { eventId: { in: eventIds } } } },
      select: { referralId: true, status: true, review: { select: { registration: { select: { eventId: true } } } } },
    }),
    db.notificationDelivery.findMany({
      where: { referral: { review: { registration: { eventId: { in: eventIds } } } } },
      select: { status: true, referral: { select: { review: { select: { registration: { select: { eventId: true } } } } } } },
    }),
    db.screeningResult.findMany({
      where: { registration: { eventId: { in: eventIds } } },
      select: { resultId: true, registration: { select: { eventId: true } } },
    }),
    db.review.findMany({
      where: { registration: { eventId: { in: eventIds } } },
      select: { reviewId: true, registration: { select: { eventId: true } } },
    }),
  ]);

  const byEvent = new Map(events.map((event) => [event.eventId, emptyEventMetrics(event)]));
  const entityEvent = new Map(eventIds.map((eventId) => [eventId, eventId]));

  for (const row of registrations) {
    const metrics = byEvent.get(row.eventId);
    if (!metrics) continue;
    metrics.registrations.total += 1;
    if (row.registrationStatus === "SIGNED_UP") metrics.registrations.signedUp += 1;
    else if (row.registrationStatus === "CHECKED_IN") metrics.registrations.checkedIn += 1;
    else if (row.registrationStatus === "COMPLETED") metrics.registrations.completed += 1;
    else if (row.registrationStatus === "CANCELLED") metrics.registrations.cancelled += 1;
    entityEvent.set(row.registrationId, row.eventId);
  }

  for (const row of queueEntries) {
    const eventId = row.registration.eventId;
    const metrics = byEvent.get(eventId);
    if (!metrics) continue;
    if (row.status === "WAITING") metrics.queue.waiting += 1;
    else if (["CALLED", "IN_PROGRESS"].includes(row.status)) metrics.queue.active += 1;
    else if (row.status === "COMPLETED") metrics.queue.completed += 1;
    else if (row.status === "SKIPPED") metrics.queue.skipped += 1;
    else if (row.status === "CANCELLED") metrics.queue.cancelled += 1;
    entityEvent.set(row.id, eventId);
  }

  for (const row of referrals) {
    const eventId = row.review.registration.eventId;
    const metrics = byEvent.get(eventId);
    if (!metrics) continue;
    metrics.referrals.total += 1;
    if (["DRAFT", "ISSUED"].includes(row.status)) metrics.referrals.actionRequired += 1;
    else if (["SENT", "ACKNOWLEDGED"].includes(row.status)) metrics.referrals.sentOrAcknowledged += 1;
    else if (row.status === "CANCELLED") metrics.referrals.cancelled += 1;
    entityEvent.set(row.referralId, eventId);
  }

  for (const row of deliveries) {
    const eventId = row.referral?.review.registration.eventId;
    const metrics = byEvent.get(eventId);
    if (!metrics) continue;
    if (["QUEUED", "SENDING"].includes(row.status)) metrics.deliveries.inFlight += 1;
    else if (["SENT", "DELIVERED"].includes(row.status)) metrics.deliveries.delivered += 1;
    else if (["FAILED", "BOUNCED", "RECONCILIATION_REQUIRED"].includes(row.status)) metrics.deliveries.issues += 1;
  }

  for (const row of screeningResults) entityEvent.set(row.resultId, row.registration.eventId);
  for (const row of reviews) entityEvent.set(row.reviewId, row.registration.eventId);

  const syncRows = entityEvent.size
    ? await db.syncAction.findMany({
        where: {
          OR: [
            { eventId: { in: eventIds } },
            { entityId: { in: [...entityEvent.keys()] } },
          ],
          createdAt: { gte: range.startsAt, lt: range.endsBefore },
        },
        select: { eventId: true, entityId: true, status: true },
      })
    : [];

  for (const row of syncRows) {
    const metrics = byEvent.get(row.eventId || entityEvent.get(row.entityId));
    if (!metrics) continue;
    metrics.sync.total += 1;
    if (["PENDING", "PROCESSING"].includes(row.status)) metrics.sync.pending += 1;
    else if (row.status === "APPLIED") metrics.sync.applied += 1;
    else if (["CONFLICT", "FAILED"].includes(row.status)) metrics.sync.issues += 1;
  }

  const reportEvents = [...byEvent.values()].map(finalizeEvent);
  return {
    filters: { eventId: query.eventId || null, from: range.from, to: range.to },
    summary: totalMetrics(reportEvents),
    events: reportEvents,
    eventOptions,
    truncated: eventCount > EVENT_LIMIT,
    eventOptionsTruncated: eventOptionCount > EVENT_LIMIT,
  };
};

module.exports = { getOperationalReport, reportRange, reportVisibility };
