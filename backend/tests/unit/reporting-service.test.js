const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { reportQuery } = require("../../schemas/eventSchemas");
const { getOperationalReport } = require("../../services/reportingService");

const eventId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const queueId = crypto.randomUUID();
const referralId = crypto.randomUUID();
const resultId = crypto.randomUUID();
const reviewId = crypto.randomUUID();

const event = {
  eventId,
  name: "Community screening",
  status: "COMPLETED",
  startsAt: new Date("2026-08-03T01:00:00.000Z"),
  endsAt: new Date("2026-08-03T09:00:00.000Z"),
  timezone: "Asia/Singapore",
};

const reportDb = (capturedWhere) => ({
  eventMembership: { findFirst: async () => ({ id: crypto.randomUUID() }) },
  event: {
    count: async () => 1,
    findMany: async ({ where, select }) => {
      capturedWhere.push(where);
      return select.timezone ? [event] : [{ eventId, name: event.name, status: event.status, startsAt: event.startsAt }];
    },
  },
  eventRegistration: {
    findMany: async () => [
      { registrationId, eventId, registrationStatus: "COMPLETED" },
      { registrationId: crypto.randomUUID(), eventId, registrationStatus: "CHECKED_IN" },
    ],
  },
  queueEntry: {
    findMany: async () => [
      { id: queueId, status: "WAITING", registration: { eventId } },
      { id: crypto.randomUUID(), status: "COMPLETED", registration: { eventId } },
    ],
  },
  referral: {
    findMany: async () => [{ referralId, status: "DRAFT", review: { registration: { eventId } } }],
  },
  notificationDelivery: {
    findMany: async () => [{ status: "FAILED", referral: { review: { registration: { eventId } } } }],
  },
  screeningResult: {
    findMany: async () => [{ resultId, registration: { eventId } }],
  },
  review: {
    findMany: async () => [{ reviewId, registration: { eventId } }],
  },
  syncAction: {
    findMany: async ({ where, select }) => {
      assert.deepEqual(select, { eventId: true, entityId: true, status: true });
      assert.ok(where.OR[0].eventId.in.includes(eventId));
      assert.ok(where.OR[1].entityId.in.includes(eventId));
      assert.ok(where.OR[1].entityId.in.includes(registrationId));
      assert.ok(where.OR[1].entityId.in.includes(queueId));
      assert.ok(where.OR[1].entityId.in.includes(referralId));
      assert.ok(where.OR[1].entityId.in.includes(resultId));
      assert.ok(where.OR[1].entityId.in.includes(reviewId));
      return [
        { eventId, entityId: registrationId, status: "APPLIED" },
        { eventId: null, entityId: resultId, status: "CONFLICT" },
        { eventId, entityId: registrationId, status: "PROCESSING" },
      ];
    },
  },
});

test("operational reports reject non-management roles before querying data", async () => {
  await assert.rejects(
    getOperationalReport({}, { userId: crypto.randomUUID(), systemRole: "STAFF", status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" }, { eventMembership: { findFirst: async () => null } }),
    (error) => error.status === 403 && error.code === "REPORT_FORBIDDEN",
  );
});

test("event-manager reports remain event scoped and return aggregate-only metrics", async () => {
  const userId = crypto.randomUUID();
  const capturedWhere = [];
  const report = await getOperationalReport(
    { from: "2026-08-01", to: "2026-08-31" },
    { userId, systemRole: "EVENT_MANAGER", status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" },
    reportDb(capturedWhere),
  );

  assert.ok(capturedWhere.every((where) => where.memberships.some.userId === userId));
  assert.equal(report.summary.events, 1);
  assert.deepEqual(report.summary.registrations, { total: 2, checkedIn: 1, completed: 1, completionRate: 50 });
  assert.deepEqual(report.summary.queue, { waiting: 1, active: 0, completed: 1 });
  assert.deepEqual(report.summary.referrals, { total: 1, actionRequired: 1, sentOrAcknowledged: 0 });
  assert.deepEqual(report.summary.deliveries, { inFlight: 0, delivered: 0, issues: 1 });
  assert.deepEqual(report.summary.sync, { total: 3, pending: 1, applied: 1, issues: 1 });

  const serialized = JSON.stringify(report).toLowerCase();
  for (const forbidden of ["nric", "clinicalsummary", "resultdata", "recipient", "destinationemail", "payload", "errorlog"]) {
    assert.equal(serialized.includes(forbidden), false, `report must not contain ${forbidden}`);
  }
});

test("report filters reject reversed and unbounded date ranges", () => {
  assert.equal(reportQuery.safeParse({ from: "2026-09-01", to: "2026-08-01" }).success, false);
  assert.equal(reportQuery.safeParse({ from: "2025-01-01", to: "2026-08-01" }).success, false);
  assert.equal(reportQuery.safeParse({ eventId, from: "2026-08-01", to: "2026-08-31" }).success, true);
});
