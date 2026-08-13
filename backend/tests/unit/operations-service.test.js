const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { operationsOverviewQuery } = require("../../schemas/operationsSchemas");
const { getOverview, operationalShiftFor } = require("../../services/operations/operationsService");

const eventId = crypto.randomUUID();
const userId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const now = new Date("2026-08-12T03:00:00.000Z");

const manager = {
  userId,
  systemRole: "EVENT_MANAGER",
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
};

const event = {
  eventId,
  name: "Community screening",
  status: "IN_PROGRESS",
  venue: "Community Hall",
  timezone: "Asia/Singapore",
  startsAt: new Date("2026-08-12T01:00:00.000Z"),
  endsAt: new Date("2026-08-12T09:00:00.000Z"),
  capacity: 100,
  stations: [{
    stationId,
    stationName: "Visual acuity",
    stationType: "VISUAL_ACUITY",
    stationOrder: 1,
    isActive: true,
    operationalStatus: "AVAILABLE",
  }],
  shifts: [{
    shiftId: crypto.randomUUID(),
    name: "Morning",
    startsAt: new Date("2026-08-12T01:00:00.000Z"),
    endsAt: new Date("2026-08-12T05:00:00.000Z"),
    requiredStaff: 2,
    status: "ACTIVE",
    staffAssignments: [{
      id: crypto.randomUUID(),
      userId,
      stationId,
      assignmentRole: "SCREENER",
      assignmentStatus: "CONFIRMED",
      status: "CONFIRMED",
    }],
  }],
};

const operationsDb = (capturedWhere = []) => ({
  eventMembership: { findFirst: async () => ({ id: crypto.randomUUID() }) },
  event: {
    findMany: async ({ where }) => {
      capturedWhere.push(where);
      return [event];
    },
  },
  eventRegistration: {
    findMany: async () => [
      { registrationId, eventId, registrationStatus: "CHECKED_IN", checkedIn: true, checkedInAt: now },
      { registrationId: crypto.randomUUID(), eventId, registrationStatus: "COMPLETED", checkedIn: true, checkedInAt: now },
    ],
  },
  queueEntry: {
    findMany: async () => [{
      id: crypto.randomUUID(),
      stationId,
      status: "WAITING",
      isPriority: true,
      enteredAt: new Date("2026-08-12T02:30:00.000Z"),
      registration: { eventId },
    }],
  },
  screeningResult: {
    findMany: async () => [{ resultId: crypto.randomUUID(), registrationId, registration: { eventId } }],
  },
  review: {
    findMany: async () => [{ reviewId: crypto.randomUUID(), registrationId, registration: { eventId } }],
  },
  referral: {
    findMany: async () => [{ referralId: crypto.randomUUID(), status: "DRAFT", review: { registration: { eventId } } }],
  },
  syncAction: {
    findMany: async () => [{ eventId, entityId: registrationId, status: "CONFLICT" }],
  },
});

test("operations query has bounded defaults", () => {
  assert.deepEqual(operationsOverviewQuery.parse({}), { status: "ALL", limit: 50 });
  assert.equal(operationsOverviewQuery.safeParse({ status: "UNKNOWN" }).success, false);
  assert.equal(operationsOverviewQuery.safeParse({ limit: 101 }).success, false);
});

test("event managers receive only scoped aggregate operational data", async () => {
  const capturedWhere = [];
  const result = await getOverview({ status: "ALL", limit: 50 }, manager, operationsDb(capturedWhere), now);

  assert.equal(capturedWhere[0].AND[0].memberships.some.userId, userId);
  assert.equal(result.summary.events.active, 1);
  assert.equal(result.summary.events.needsAttention, 1);
  assert.deepEqual(result.events[0].progress, {
    total: 2,
    signedUp: 0,
    checkedIn: 2,
    completed: 1,
    screened: 1,
    reviewed: 1,
  });
  assert.equal(result.events[0].queue.waiting, 1);
  assert.equal(result.events[0].queue.priority, 1);
  assert.equal(result.events[0].queue.longestWaitMinutes, 30);
  assert.equal(result.events[0].staffing.assigned, 1);
  assert.equal(result.events[0].staffing.unfilled, 1);
  assert.equal(result.events[0].stations.items[0].staffed, true);
  assert.equal(result.events[0].attention.severity, "critical");

  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ["participantdisplayname", "participantreference", "resultdata", "clinicalsummary", "prioritynotes", "recipient"]) {
    assert.equal(serialized.includes(forbidden), false, `operations response must not contain ${forbidden}`);
  }
});

test("non-manager staff are rejected before operational data is queried", async () => {
  await assert.rejects(
    getOverview(
      { status: "ALL", limit: 50 },
      { ...manager, userId: crypto.randomUUID(), systemRole: "STAFF" },
      { eventMembership: { findFirst: async () => null } },
      now,
    ),
    (error) => error.status === 403 && error.code === "OPERATIONS_FORBIDDEN",
  );
});

test("the current active shift drives staffing coverage", () => {
  const later = {
    ...event.shifts[0],
    shiftId: crypto.randomUUID(),
    name: "Afternoon",
    startsAt: new Date("2026-08-12T05:00:00.000Z"),
    endsAt: new Date("2026-08-12T09:00:00.000Z"),
  };
  assert.equal(operationalShiftFor({ ...event, shifts: [event.shifts[0], later] }, now).name, "Morning");
});
