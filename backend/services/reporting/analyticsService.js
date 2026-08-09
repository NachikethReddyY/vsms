const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { requireEventManager } = require("../event/eventAuthorizationService");
const { ATTENDANCE_DEFINITION } = require("../event/attendanceDefinition");

const DEFAULT_SMALL_CELL_THRESHOLD = 5;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

const METRIC_DEFINITIONS = Object.freeze([
  { key: "registered", label: "Registered", unit: "registrations", definition: "Event-lifetime: all non-cancelled registrations, irrespective of the operational interval." },
  { key: "attendance", label: "Attendance", unit: "registrations", definition: `Event-lifetime: ${ATTENDANCE_DEFINITION}` },
  { key: "attendanceRate", label: "Attendance rate", unit: "percent", definition: "Attendance divided by non-cancelled registrations; zero when the denominator is zero." },
  { key: "queueWaitP50", label: "Median queue wait", unit: "minutes", definition: "PostgreSQL percentile_cont(0.50) over non-negative elapsed minutes from enteredAt to startedAt, falling back to calledAt." },
  { key: "queueWaitP90", label: "90th percentile queue wait", unit: "minutes", definition: "PostgreSQL percentile_cont(0.90) over the same queue-wait population." },
  { key: "serviceP50", label: "Median service time", unit: "minutes", definition: "PostgreSQL percentile_cont(0.50) over non-negative elapsed minutes from startedAt/calledAt to completedAt." },
  { key: "stationThroughput", label: "Station throughput", unit: "completed queue visits", definition: "Operational interval: queue visits completed at each station in [from,to)." },
  { key: "clinicalDistribution", label: "Clinical distributions", unit: "records", definition: "Operational interval: screening and review groups. If any nonzero cell is below the threshold, the entire clinical block is withheld." },
  { key: "referralDelivery", label: "Referral and delivery state", unit: "records", definition: "Operational interval: referral workflow and SES delivery groups. If any nonzero cell is below the threshold, the entire referral block is withheld." },
]);

const number = (value) => value == null ? null : Number(value);
const count = (value) => Number(value || 0);
const rounded = (value) => value == null ? null : Math.round(Number(value) * 10) / 10;

function resolveBounds(event, filters = {}) {
  const from = filters.from ? new Date(filters.from) : new Date(event.startsAt);
  const to = filters.to ? new Date(filters.to) : new Date(event.endsAt);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new AppError(422, "INVALID_ANALYTICS_RANGE", "Analytics from must be before to");
  }
  if (to - from > MAX_RANGE_MS) throw new AppError(422, "ANALYTICS_RANGE_TOO_LARGE", "Analytics range cannot exceed 366 days");
  if (from < new Date(event.startsAt) || to > new Date(event.endsAt)) {
    throw new AppError(422, "ANALYTICS_RANGE_OUTSIDE_EVENT", "Analytics range must be within the event start and end timestamps");
  }
  return { from, to };
}

const suppressClinicalRows = (rows, threshold) => rows.map((row) => {
  const value = count(row.count);
  return value > 0 && value < threshold
    ? { ...row, count: null, suppressed: true, suppressionReason: `Count is below ${threshold}` }
    : { ...row, count: value, suppressed: false, suppressionReason: null };
});

function suppressSensitiveBlock(rows, threshold) {
  const normalized = rows.map((row) => ({ ...row, count: count(row.count) }));
  const suppressed = normalized.some((row) => row.count > 0 && row.count < threshold);
  return {
    suppressed,
    rows: suppressed ? [] : normalized.map((row) => ({ ...row, suppressed: false, suppressionReason: null })),
  };
}

const table = (id, title, columns, rows) => ({ id, title, columns, rows });

async function aggregateRows(db, eventId, from, to) {
  const [registrationRows, queueRows, stationRows, screeningRows, reviewRows, referralRows, completenessRows] = await Promise.all([
    db.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE registration_status <> 'CANCELLED') AS registered,
        COUNT(*) FILTER (WHERE registration_status = 'CANCELLED') AS cancelled,
        COUNT(*) FILTER (WHERE registration_status <> 'CANCELLED' AND (checked_in = TRUE OR checked_in_at IS NOT NULL)) AS attended,
        COUNT(*) FILTER (WHERE registration_status = 'COMPLETED') AS completed
      FROM event_registrations WHERE event_id = ${eventId}::uuid
    `),
    db.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE q.status = 'WAITING') AS waiting,
        COUNT(*) FILTER (WHERE q.status IN ('CALLED', 'IN_PROGRESS')) AS active,
        COUNT(*) FILTER (WHERE q.status = 'COMPLETED' AND q.completed_at >= ${from} AND q.completed_at < ${to}) AS completed,
        COUNT(*) FILTER (WHERE q.status = 'SKIPPED') AS skipped,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(q.started_at, q.called_at) - q.entered_at)) / 60.0)
          FILTER (WHERE COALESCE(q.started_at, q.called_at) >= q.entered_at) AS wait_p50,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(q.started_at, q.called_at) - q.entered_at)) / 60.0)
          FILTER (WHERE COALESCE(q.started_at, q.called_at) >= q.entered_at) AS wait_p90,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (q.completed_at - COALESCE(q.started_at, q.called_at))) / 60.0)
          FILTER (WHERE q.completed_at >= COALESCE(q.started_at, q.called_at)) AS service_p50,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (q.completed_at - COALESCE(q.started_at, q.called_at))) / 60.0)
          FILTER (WHERE q.completed_at >= COALESCE(q.started_at, q.called_at)) AS service_p90
      FROM queue_entries q
      JOIN event_registrations r ON r.registration_id = q.registration_id
      WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        AND q.entered_at >= ${from} AND q.entered_at < ${to}
    `),
    db.$queryRaw(Prisma.sql`
      SELECT s.station_name, s.station_type::text,
        COUNT(*) FILTER (WHERE q.status = 'COMPLETED') AS completed,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (q.completed_at - COALESCE(q.started_at, q.called_at))) / 60.0)
          FILTER (WHERE q.completed_at >= COALESCE(q.started_at, q.called_at)) AS service_p50
      FROM stations s
      LEFT JOIN queue_entries q ON q.station_id = s.station_id AND q.completed_at >= ${from} AND q.completed_at < ${to}
        AND EXISTS (
          SELECT 1 FROM event_registrations r
          WHERE r.registration_id = q.registration_id AND r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        )
      WHERE s.event_id = ${eventId}::uuid
      GROUP BY s.station_id, s.station_name, s.station_type, s.station_order
      ORDER BY s.station_order, s.station_id
    `),
    db.$queryRaw(Prisma.sql`
      SELECT sr.overall_flag::text AS category, COUNT(*) AS count
      FROM screening_results sr JOIN event_registrations r ON r.registration_id = sr.registration_id
      WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        AND sr.created_at >= ${from} AND sr.created_at < ${to}
      GROUP BY sr.overall_flag ORDER BY sr.overall_flag
    `),
    db.$queryRaw(Prisma.sql`
      SELECT 'OUTCOME' AS dimension, rv.outcome::text AS category, COUNT(*) AS count
      FROM reviews rv JOIN event_registrations r ON r.registration_id = rv.registration_id
      WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        AND rv.reviewed_at >= ${from} AND rv.reviewed_at < ${to}
      GROUP BY rv.outcome
      UNION ALL
      SELECT 'URGENCY', rv.urgency::text, COUNT(*)
      FROM reviews rv JOIN event_registrations r ON r.registration_id = rv.registration_id
      WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        AND rv.reviewed_at >= ${from} AND rv.reviewed_at < ${to}
      GROUP BY rv.urgency ORDER BY 1, 2
    `),
    db.$queryRaw(Prisma.sql`
      SELECT 'REFERRAL_STATUS' AS dimension, rf.status::text AS category, COUNT(*) AS count
      FROM referrals rf JOIN event_registrations r ON r.registration_id = rf.registration_id
      WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        AND rf.created_at >= ${from} AND rf.created_at < ${to}
      GROUP BY rf.status
      UNION ALL
      SELECT 'REFERRAL_URGENCY', rf.urgency::text, COUNT(*)
      FROM referrals rf JOIN event_registrations r ON r.registration_id = rf.registration_id
      WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        AND rf.created_at >= ${from} AND rf.created_at < ${to}
      GROUP BY rf.urgency
      UNION ALL
      SELECT 'DELIVERY_STATUS', nd.status::text, COUNT(*)
      FROM notification_deliveries nd
      JOIN referrals rf ON rf.referral_id = nd.referral_id
      JOIN event_registrations r ON r.registration_id = rf.registration_id
      WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
        AND nd.created_at >= ${from} AND nd.created_at < ${to}
      GROUP BY nd.status ORDER BY 1, 2
    `),
    db.$queryRaw(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM event_registrations r
          WHERE r.event_id = ${eventId}::uuid AND r.checked_in = TRUE AND r.checked_in_at IS NULL AND r.registration_status <> 'CANCELLED') AS attendance_timestamp_missing,
        (SELECT COUNT(*) FROM queue_entries q JOIN event_registrations r ON r.registration_id = q.registration_id
          WHERE r.event_id = ${eventId}::uuid AND r.registration_status <> 'CANCELLED'
            AND q.completed_at >= ${from} AND q.completed_at < ${to}
            AND q.status = 'COMPLETED' AND (q.completed_at IS NULL OR COALESCE(q.started_at, q.called_at) IS NULL)) AS queue_timestamps_missing
    `),
  ]);
  return { registrationRows, queueRows, stationRows, screeningRows, reviewRows, referralRows, completenessRows };
}

function buildAnalytics(event, filters, aggregates, threshold, generatedAt) {
  const registrations = aggregates.registrationRows[0] || {};
  const queues = aggregates.queueRows[0] || {};
  const completeness = aggregates.completenessRows[0] || {};
  const registered = count(registrations.registered);
  const attendance = count(registrations.attended);
  const attendanceRate = registered ? Math.round((attendance / registered) * 1000) / 10 : 0;
  const clinical = suppressSensitiveBlock([
    ...aggregates.screeningRows.map((row) => ({ category: row.category, count: row.count })),
    ...aggregates.reviewRows.map((row) => ({ dimension: row.dimension, category: row.category, count: row.count })),
  ], threshold);
  const screening = clinical.rows.filter((row) => !row.dimension);
  const reviews = clinical.rows.filter((row) => row.dimension);
  const referral = suppressSensitiveBlock(aggregates.referralRows.map((row) => ({ dimension: row.dimension, category: row.category, count: row.count })), threshold);
  const referralRows = referral.rows.sort((left, right) => left.dimension < right.dimension ? -1 : left.dimension > right.dimension ? 1 : left.category < right.category ? -1 : left.category > right.category ? 1 : 0);
  const flags = [];
  if (count(completeness.attendance_timestamp_missing)) flags.push({ code: "ATTENDANCE_TIMESTAMP_MISSING", count: count(completeness.attendance_timestamp_missing), message: "Some attended registrations have no checked-in timestamp." });
  if (count(completeness.queue_timestamps_missing)) flags.push({ code: "QUEUE_TIMESTAMPS_MISSING", count: count(completeness.queue_timestamps_missing), message: "Some completed queue visits cannot contribute to service percentiles." });
  const observations = [
    registered ? `${attendance} of ${registered} non-cancelled registrations attended (${attendanceRate}%).` : "No non-cancelled registrations were recorded in the applied interval.",
    number(queues.wait_p90) == null ? "Queue wait percentiles are unavailable because no valid wait intervals were recorded." : `90% of measured queue waits were ${rounded(queues.wait_p90)} minutes or less.`,
    flags.length ? `${flags.length} data completeness warning${flags.length === 1 ? "" : "s"} applies to these aggregates.` : "No timestamp completeness warnings were detected for the defined metrics.",
  ];
  return {
    schemaVersion: 1,
    aggregateOnly: true,
    generatedAt: generatedAt.toISOString(),
    event: { eventId: event.eventId, name: event.name, status: event.status, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone },
    timeBasis: { storageTimezone: "UTC", displayTimezone: event.timezone, interval: "[from,to)", from: filters.from.toISOString(), to: filters.to.toISOString() },
    appliedFilters: { from: filters.from.toISOString(), to: filters.to.toISOString(), eventLifetimePopulation: "registrations and attendance", operationalIntervalPopulation: "queue, station, screening, review, referral, and delivery records", attendanceExcludesCancelled: true },
    metricDefinitions: METRIC_DEFINITIONS,
    smallCellSuppression: { threshold, rule: `If any nonzero sensitive cell is below ${threshold}, its entire clinical or referral block is withheld without totals or completeness counts.` },
    tables: [
      table("registrations", "Registration and attendance", [
        { key: "registered", label: "Registered", type: "integer" }, { key: "attendance", label: "Attended", type: "integer" },
        { key: "attendanceRate", label: "Attendance rate (%)", type: "number" }, { key: "completed", label: "Completed", type: "integer" },
        { key: "cancelled", label: "Cancelled", type: "integer" },
      ], [{ registered, attendance, attendanceRate, completed: count(registrations.completed), cancelled: count(registrations.cancelled) }]),
      table("queue", "Queue timing", [
        { key: "waiting", label: "Waiting", type: "integer" }, { key: "active", label: "Active", type: "integer" }, { key: "completed", label: "Completed", type: "integer" },
        { key: "skipped", label: "Skipped", type: "integer" }, { key: "waitP50Minutes", label: "Wait p50 (min)", type: "number" },
        { key: "waitP90Minutes", label: "Wait p90 (min)", type: "number" }, { key: "serviceP50Minutes", label: "Service p50 (min)", type: "number" },
        { key: "serviceP90Minutes", label: "Service p90 (min)", type: "number" },
      ], [{ waiting: count(queues.waiting), active: count(queues.active), completed: count(queues.completed), skipped: count(queues.skipped), waitP50Minutes: rounded(queues.wait_p50), waitP90Minutes: rounded(queues.wait_p90), serviceP50Minutes: rounded(queues.service_p50), serviceP90Minutes: rounded(queues.service_p90) }]),
      table("stations", "Station throughput", [
        { key: "stationName", label: "Station", type: "string" }, { key: "stationType", label: "Type", type: "string" },
        { key: "completed", label: "Completed visits", type: "integer" }, { key: "serviceP50Minutes", label: "Service p50 (min)", type: "number" },
      ], aggregates.stationRows.map((row) => ({ stationName: row.station_name, stationType: row.station_type, completed: count(row.completed), serviceP50Minutes: rounded(row.service_p50) }))),
      { ...table("screening", "Screening outcome distribution", [{ key: "category", label: "Overall flag", type: "string" }, { key: "count", label: "Count", type: "integer" }, { key: "suppressed", label: "Suppressed", type: "boolean" }], screening), suppressed: clinical.suppressed },
      { ...table("reviews", "Review outcomes and urgency", [{ key: "dimension", label: "Dimension", type: "string" }, { key: "category", label: "Category", type: "string" }, { key: "count", label: "Count", type: "integer" }, { key: "suppressed", label: "Suppressed", type: "boolean" }], reviews), suppressed: clinical.suppressed },
      { ...table("referrals", "Referral urgency and delivery states", [{ key: "dimension", label: "Dimension", type: "string" }, { key: "category", label: "State", type: "string" }, { key: "count", label: "Count", type: "integer" }, { key: "suppressed", label: "Suppressed", type: "boolean" }], referralRows), suppressed: referral.suppressed },
    ],
    observations,
    dataCompleteness: { complete: flags.length === 0, flags },
  };
}

async function getCompletedEventAnalytics(eventId, filters, user, db = prisma, now = new Date()) {
  const authorization = await requireEventManager(eventId, user, { db });
  if (authorization.event.status !== "COMPLETED") throw new AppError(409, "EVENT_NOT_COMPLETED", "Analytics are available only for completed events");
  const event = await db.event.findUnique({ where: { eventId }, select: { eventId: true, name: true, status: true, startsAt: true, endsAt: true, timezone: true } });
  const bounds = resolveBounds(event, filters);
  const configured = Number(process.env.ANALYTICS_SMALL_CELL_THRESHOLD || DEFAULT_SMALL_CELL_THRESHOLD);
  const threshold = Number.isInteger(configured) && configured >= 2 && configured <= 20 ? configured : DEFAULT_SMALL_CELL_THRESHOLD;
  return buildAnalytics(event, bounds, await aggregateRows(db, eventId, bounds.from, bounds.to), threshold, now);
}

module.exports = {
  DEFAULT_SMALL_CELL_THRESHOLD,
  METRIC_DEFINITIONS,
  aggregateRows,
  buildAnalytics,
  getCompletedEventAnalytics,
  resolveBounds,
  suppressClinicalRows,
  suppressSensitiveBlock,
};
