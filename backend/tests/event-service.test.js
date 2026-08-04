const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../prisma/prismaClient");
const eventService = require("../services/eventService");

const manager = { userId: crypto.randomUUID(), systemRole: "ADMIN" };
const staffId = crypto.randomUUID();
const eventId = crypto.randomUUID();
const shiftId = crypto.randomUUID();
const startsAt = new Date("2040-01-01T01:00:00.000Z");
const endsAt = new Date("2040-01-01T05:00:00.000Z");
const FORBIDDEN_EVENT_RESPONSE_KEYS = [
  "createIdempotencyKey",
  "createPayloadHash",
  "createdByUserId",
  "cancelledByUserId",
];

const assertForbiddenEventKeysAbsent = (value) => {
  for (const key of FORBIDDEN_EVENT_RESPONSE_KEYS) {
    assert.equal(Object.hasOwn(value, key), false, `event response must not own ${key}`);
  }
};

const eventRecord = (status = "DRAFT", version = 1, assignments = [], registrations = []) => ({
  eventId,
  name: "Service test event",
  venue: "Test hall",
  timezone: "Asia/Singapore",
  startsAt,
  endsAt,
  status,
  version,
  capacity: 10,
  createdByUserId: manager.userId,
  shifts: [{ shiftId, eventId, name: "Main", startsAt, endsAt, requiredStaff: 1, status: "PLANNED", staffAssignments: assignments }],
  stations: [],
  eventDays: [],
  registrations,
  _count: { registrations: registrations.length },
});

function installTransaction(t, current, updated, overrides = {}) {
  const originalFindFirst = prisma.event.findFirst;
  const originalTransaction = prisma.$transaction;
  prisma.event.findFirst = async () => current;
  prisma.$transaction = async (callback) => callback({
    event: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => updated,
    },
    shift: { updateMany: async () => ({ count: 1 }) },
    staffAssignment: {
      findFirst: async () => null,
      create: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
    user: { findFirst: async () => ({ id: staffId, userRoles: [{ role: { roleName: "SUPPORT" } }] }) },
    stationTemplate: { findMany: async () => [] },
    eventAuditLog: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
    $executeRawUnsafe: async () => 1,
    ...overrides,
  });
  t.after(() => {
    prisma.event.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  });
}

test("staff assignment saves an active user and preserves manager permissions", async (t) => {
  const current = eventRecord();
  const assignment = {
    id: crypto.randomUUID(),
    userId: staffId,
    assignmentRole: "SUPPORT",
    status: "ASSIGNED",
    notes: null,
    assignedUser: { id: staffId, username: "staff", fullName: "Staff", email: "staff@example.com" },
    station: null,
  };
  const updated = eventRecord("DRAFT", 2, [assignment]);
  let saved;
  installTransaction(t, current, updated, {
    staffAssignment: {
      findFirst: async () => null,
      create: async ({ data }) => { saved = data; return assignment; },
    },
  });

  const result = await eventService.addStaffAssignment(eventId, shiftId, {
    version: 1,
    userId: staffId,
    assignmentRole: "SUPPORT",
  }, manager, crypto.randomUUID());

  assert.equal(saved.assignedBy, manager.userId);
  assert.equal(result.shifts[0].staffAssignments[0].user.userId, staffId);
  assert.equal(result.canManage, true);
});

test("event transitions update by eventId and keep the next manager action available", async (t) => {
  const current = eventRecord();
  const updated = eventRecord("PUBLISHED", 2);
  let updateWhere;
  installTransaction(t, current, updated, {
    event: {
      updateMany: async ({ where }) => { updateWhere = where; return { count: 1 }; },
      findUniqueOrThrow: async () => updated,
    },
  });

  const result = await eventService.transitionEvent(eventId, "publish", { version: 1 }, manager, crypto.randomUUID());

  assert.equal(updateWhere.eventId, eventId);
  assert.equal(updateWhere.id, undefined);
  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.canManage, true);
});

test("draft event managers can save the complete edit-form planning payload", async (t) => {
  const current = { ...eventRecord(), shifts: [], stations: [], eventDays: [] };
  const day = {
    eventDayId: crypto.randomUUID(),
    date: new Date("2040-01-01T00:00:00.000Z"),
    startsAt,
    endsAt,
  };
  const updated = {
    ...current,
    version: 2,
    address: "1 Test Street",
    postalCode: "123456",
    latitude: 1.3,
    longitude: 103.8,
    locationProvider: "ONEMAP",
    locationReference: "test-location",
    expectedAttendance: 8,
    eventDays: [day],
  };
  let updateData;
  installTransaction(t, current, updated, {
    event: {
      updateMany: async ({ data }) => { updateData = data; return { count: 1 }; },
      findUniqueOrThrow: async () => updated,
    },
    eventDay: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => day,
      findMany: async () => [],
    },
    eventStationAvailability: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
    station: { findMany: async () => [] },
    stationTemplate: { findMany: async () => [] },
    shift: {
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
    staffAssignment: { findFirst: async () => null },
  });

  const result = await eventService.updateEvent(eventId, {
    version: 1,
    name: current.name,
    description: null,
    bannerKey: "COMMUNITY_SCREENING",
    artworkDataUrl: null,
    venue: current.venue,
    address: updated.address,
    postalCode: updated.postalCode,
    latitude: updated.latitude,
    longitude: updated.longitude,
    locationProvider: updated.locationProvider,
    locationReference: updated.locationReference,
    timezone: current.timezone,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    capacity: current.capacity,
    expectedAttendance: updated.expectedAttendance,
    eventDays: [{ date: "2040-01-01", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }],
    stations: [],
    shifts: [],
  }, manager, crypto.randomUUID());

  assert.equal(updateData.address, "1 Test Street");
  assert.equal(updateData.expectedAttendance, 8);
  assert.equal(result.eventDays.length, 1);
  assert.equal(result.canManage, true);
});

test("event responses count only checked-in registrations toward venue capacity", async (t) => {
  const current = eventRecord();
  const updated = eventRecord("PUBLISHED", 2, [], [
    { registrationId: crypto.randomUUID(), registrationStatus: "SIGNED_UP" },
    { registrationId: crypto.randomUUID(), registrationStatus: "CHECKED_IN" },
  ]);
  installTransaction(t, current, updated);

  const result = await eventService.transitionEvent(eventId, "publish", { version: 1 }, manager, crypto.randomUUID());

  assert.equal(result.activeCapacityCount, 1);
  assert.equal(result.signupCount, 2);
});

function installDeletionTransaction(t, { claimCount = 1, crossEventReview = false } = {}) {
  const originalFindFirst = prisma.event.findFirst;
  const originalTransaction = prisma.$transaction;
  const calls = [];
  const remove = (name) => ({ deleteMany: async (input) => { calls.push([name, input]); return { count: 1 }; } });
  prisma.event.findFirst = async () => eventRecord("COMPLETED");
  prisma.$transaction = async (callback) => callback({
    event: {
      updateMany: async (input) => { calls.push(["event.update", input]); return { count: claimCount }; },
      deleteMany: async (input) => { calls.push(["event.delete", input]); return { count: 1 }; },
    },
    eventRegistration: { findMany: async () => [], ...remove("registrations") },
    participant: { updateMany: async (input) => { calls.push(["participants.clearOnboardingEvent", input]); return { count: 1 }; } },
    station: { findMany: async () => [], ...remove("stations") },
    review: {
      findMany: async () => crossEventReview ? [{ reviewId: crypto.randomUUID() }] : [],
      findFirst: async () => crossEventReview ? { reviewId: crypto.randomUUID() } : null,
      updateMany: async () => ({ count: 0 }),
      ...remove("reviews"),
    },
    participantConsent: { findMany: async () => [], updateMany: async () => ({ count: 0 }), ...remove("consents") },
    notificationDelivery: remove("deliveries"),
    documentArtifact: { findMany: async () => [], findFirst: async () => null, ...remove("documents") },
    referral: { findMany: async () => [], ...remove("referrals") },
    signatureArtifact: { findMany: async () => [], ...remove("signatures") },
    artifactCleanupTask: { createMany: async () => ({ count: 0 }) },
    registrationStatusHistory: remove("registrationHistory"),
    screeningResult: remove("screeningResults"),
    scanLog: remove("scanLogs"),
    qRCodePass: remove("qrPasses"),
    queueMovement: remove("queueMovements"),
    queueEntry: remove("queueEntries"),
    staffAssignment: remove("staffAssignments"),
    shift: remove("shifts"),
    eventStationAvailability: remove("stationAvailability"),
    eventDay: remove("eventDays"),
    eventAuditLog: remove("eventAudit"),
    auditLog: { create: async (input) => { calls.push(["ledger", input]); return {}; } },
  });
  t.after(() => {
    prisma.event.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  });
  return calls;
}

test("terminal event deletion removes only event-owned records and leaves a non-PHI ledger", async (t) => {
  const calls = installDeletionTransaction(t);
  const administrator = { ...manager, roles: ["ADMINISTRATOR"] };

  const result = await eventService.deleteEvent(eventId, {
    version: 1,
    confirmationName: "Service test event",
    acknowledgePermanentDeletion: true,
  }, administrator, crypto.randomUUID());

  assert.deepEqual(result, { eventId, deleted: true });
  assert.deepEqual(calls.find(([name]) => name === "participants.clearOnboardingEvent")[1], {
    where: { onboardingEventId: eventId },
    data: { onboardingEventId: null },
  });
  assert.deepEqual(calls.find(([name]) => name === "event.update")[1].where, {
    eventId,
    version: 1,
    status: "COMPLETED",
  });
  assert.deepEqual(calls.find(([name]) => name === "event.delete")[1].where, {
    eventId,
    version: 2,
    status: "COMPLETED",
  });
  const ledger = calls.find(([name]) => name === "ledger")[1].data;
  assert.equal(ledger.action, "EVENT_DELETED");
  assert.deepEqual(ledger.details, { status: "COMPLETED", version: 1 });
  assert.ok(calls.some(([name]) => name === "registrations"));
  assert.ok(calls.some(([name]) => name === "stations"));
});

test("terminal event deletion denies non-administrators and stale versions", async (t) => {
  await assert.rejects(
    eventService.deleteEvent(eventId, { version: 1, confirmationName: "Service test event", acknowledgePermanentDeletion: true }, { ...manager, systemRole: "EVENT_MANAGER", roles: ["EVENT_MANAGER"] }, crypto.randomUUID()),
    (error) => error.code === "FORBIDDEN",
  );

  const calls = installDeletionTransaction(t, { claimCount: 0 });
  await assert.rejects(
    eventService.deleteEvent(eventId, { version: 1, confirmationName: "Service test event", acknowledgePermanentDeletion: true }, { ...manager, roles: ["ADMINISTRATOR"] }, crypto.randomUUID()),
    (error) => error.code === "STALE_EVENT_VERSION",
  );
  assert.equal(calls.some(([name]) => name === "event.delete"), false);
});

test("terminal event deletion rejects cross-event review references before deleting children", async (t) => {
  const calls = installDeletionTransaction(t, { crossEventReview: true });
  await assert.rejects(
    eventService.deleteEvent(eventId, { version: 1, confirmationName: "Service test event", acknowledgePermanentDeletion: true }, { ...manager, roles: ["ADMINISTRATOR"] }, crypto.randomUUID()),
    (error) => error.code === "EVENT_DELETE_INTEGRITY_CONFLICT",
  );
  assert.equal(calls.some(([name]) => ["documents", "referrals", "registrations", "event.delete"].includes(name)), false);
});
