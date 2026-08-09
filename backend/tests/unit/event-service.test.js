const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const eventService = require("../../services/event/eventService");

const manager = { userId: crypto.randomUUID(), systemRole: "ADMIN", roles: ["ADMINISTRATOR"], status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
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
  cancelledByUserId: crypto.randomUUID(),
  createIdempotencyKey: "internal-replay-key",
  createPayloadHash: "a".repeat(64),
  shifts: [{ shiftId, eventId, name: "Main", startsAt, endsAt, requiredStaff: 1, status: "PLANNED", staffAssignments: assignments.length ? assignments : [{ userId: manager.userId, status: "ASSIGNED" }] }],
  stations: [{ stationId: crypto.randomUUID(), stationName: "Planning station", stationType: "VISUAL_ACUITY", stationOrder: 1, isActive: true }],
  eventDays: [],
  registrations,
  _count: { registrations: registrations.length },
  memberships: [{ userId: manager.userId, roles: [{ role: "EVENT_MANAGER" }] }],
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
    domainEvent: { create: async () => ({}) },
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

test("event responses count canonical attendance toward venue capacity", async (t) => {
  const current = eventRecord();
  const updated = eventRecord("PUBLISHED", 2, [], [
    { registrationId: crypto.randomUUID(), registrationStatus: "CHECKED_IN", checkedIn: true },
    { registrationId: crypto.randomUUID(), registrationStatus: "COMPLETED", checkedIn: true },
  ]);
  installTransaction(t, current, updated);

  const result = await eventService.transitionEvent(eventId, "publish", { version: 1 }, manager, crypto.randomUUID());

  assert.equal(result.activeCapacityCount, 2);
  assert.equal(result.signupCount, 2);
});

test("event responses project operational staff to only their own planned or active shift instructions", async (t) => {
  const otherStaffId = crypto.randomUUID();
  const ownStationId = crypto.randomUUID();
  const otherStationId = crypto.randomUUID();
  const templateId = crypto.randomUUID();
  const ownAssignment = {
    id: crypto.randomUUID(),
    userId: staffId,
    assignmentRole: "SUPPORT",
    status: "ASSIGNED",
    notes: "Report to the north entrance",
    assignedUser: { id: staffId, username: "support", fullName: "Support Person", email: "support@example.com" },
    station: { stationId: ownStationId, stationName: "Welcome", stationOrder: 1, stationType: "VISUAL_ACUITY" },
  };
  const otherAssignment = {
    id: crypto.randomUUID(),
    userId: otherStaffId,
    assignmentRole: "EVENT_MANAGER",
    status: "CONFIRMED",
    notes: "Private instructions for another employee",
    assignedUser: { id: otherStaffId, username: "other", fullName: "Other Person", email: "other@example.com" },
    station: { stationId: otherStationId, stationName: "Other station", stationOrder: 2, stationType: "REFRACTION" },
  };
  const current = {
    ...eventRecord("PUBLISHED", 1, [ownAssignment, otherAssignment]),
    createdBy: { id: manager.userId, username: "admin", fullName: "Admin", email: "admin@example.com", sysRole: "ADMIN", status: "ACTIVE" },
    shifts: [
      eventRecord().shifts[0],
      { ...eventRecord().shifts[0], shiftId: crypto.randomUUID(), status: "ACTIVE", staffAssignments: [ownAssignment, otherAssignment] },
      { ...eventRecord().shifts[0], shiftId: crypto.randomUUID(), status: "COMPLETED", staffAssignments: [ownAssignment] },
    ],
    stations: [ownAssignment.station, otherAssignment.station],
    memberships: [
      { userId: manager.userId, roles: [{ role: "EVENT_MANAGER" }] },
      { userId: staffId, roles: [{ role: "SUPPORT" }] },
      { userId: otherStaffId, roles: [{ role: "EVENT_MANAGER" }] },
    ],
  };
  current.shifts[0].staffAssignments = [otherAssignment];

  const originalFindFirst = prisma.event.findFirst;
  const originalTemplates = prisma.stationTemplate.findMany;
  prisma.event.findFirst = async () => current;
  prisma.stationTemplate.findMany = async () => [{
    stationTemplateId: templateId,
    templateKey: "VISUAL_ACUITY",
    version: 1,
    name: "Visual acuity",
    description: null,
    defaultCapacity: 3,
  }];
  t.after(() => {
    prisma.event.findFirst = originalFindFirst;
    prisma.stationTemplate.findMany = originalTemplates;
  });

  const supportResult = await eventService.getEvent(eventId, {
    userId: staffId,
    systemRole: "STAFF",
    roles: ["SUPPORT"],
    status: "ACTIVE",
    approvalState: "APPROVED",
    accessState: "ENABLED",
  });
  assert.equal(supportResult.canManage, false);
  assert.equal(supportResult.shifts.length, 1);
  assert.deepEqual(supportResult.shifts[0].staffAssignments.map(({ user }) => user.userId), [staffId]);
  assert.equal(supportResult.shifts[0].staffAssignments[0].notes, "Report to the north entrance");
  assert.deepEqual(supportResult.eventStations.map(({ eventStationId }) => eventStationId), [ownStationId]);
  assert.equal(supportResult.createdBy, undefined);
  assert.equal(Object.hasOwn(supportResult, "createdBy"), false);
  assert.equal(Object.hasOwn(supportResult, "cancelledBy"), false);
  assertForbiddenEventKeysAbsent(supportResult);
  assert.doesNotMatch(JSON.stringify(supportResult), /other@example\.com|Private instructions|admin@example\.com/);

  const managerResult = await eventService.getEvent(eventId, { ...manager, roles: ["ADMINISTRATOR"] });
  assert.equal(managerResult.canManage, true);
  assert.equal(managerResult.shifts.length, 3);
  assert.equal(managerResult.shifts[1].staffAssignments.length, 2);
  assert.equal(managerResult.createdBy.email, "admin@example.com");
  assertForbiddenEventKeysAbsent(managerResult);

  const assignedManagerResult = await eventService.getEvent(eventId, {
    userId: otherStaffId,
    systemRole: "EVENT_MANAGER",
    roles: ["EVENT_MANAGER"],
    status: "ACTIVE",
    approvalState: "APPROVED",
    accessState: "ENABLED",
  });
  assert.equal(assignedManagerResult.canManage, true);
  assert.equal(assignedManagerResult.shifts[1].staffAssignments.length, 2);
});

function installDeletionTransaction(t, { transactionVersion = 1, crossEventReview = false } = {}) {
  const originalFindUnique = prisma.event.findUnique;
  const originalTransaction = prisma.$transaction;
  const originalCleanupFindMany = prisma.artifactCleanupTask.findMany;
  const calls = [];
  const remove = (name) => ({ deleteMany: async (input) => { calls.push([name, input]); return { count: 1 }; } });
  const current = eventRecord("COMPLETED");
  prisma.event.findUnique = async () => current;
  prisma.artifactCleanupTask.findMany = async () => [];
  prisma.$transaction = async (callback) => callback({
    event: {
      findUnique: async () => ({ ...current, version: transactionVersion }),
      updateMany: async (input) => { calls.push(["event.update", input]); return { count: 1 }; },
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
    notificationDelivery: { count: async () => 0, ...remove("deliveries") },
    documentArtifact: { findMany: async () => [], findFirst: async () => null, ...remove("documents") },
    referral: { findMany: async () => [], ...remove("referrals") },
    signatureArtifact: { findMany: async () => [], ...remove("signatures") },
    artifactCleanupTask: { count: async () => 0, createMany: async () => ({ count: 0 }) },
    reportExportJob: { count: async () => 0 },
    registrationStatusHistory: remove("registrationHistory"),
    screeningResult: { findMany: async () => [], findFirst: async () => null, ...remove("screeningResults") },
    syncAction: remove("syncActions"),
    scanLog: remove("scanLogs"),
    qRCodePass: { findMany: async () => [], ...remove("qrPasses") },
    queueMovement: { findFirst: async () => null, ...remove("queueMovements") },
    queueEntry: { findMany: async () => [], findFirst: async () => null, ...remove("queueEntries") },
    staffAssignment: remove("staffAssignments"),
    shift: remove("shifts"),
    eventStationAvailability: remove("stationAvailability"),
    eventDay: remove("eventDays"),
    eventAuditLog: { create: async (input) => { calls.push(["eventAudit", input]); return {}; } },
    auditLog: { create: async (input) => { calls.push(["ledger", input]); return {}; } },
    $queryRawUnsafe: async (...input) => { calls.push(["audit.deleteScope", input]); return [{ set_config: eventId }]; },
  });
  t.after(() => {
    prisma.event.findUnique = originalFindUnique;
    prisma.artifactCleanupTask.findMany = originalCleanupFindMany;
    prisma.$transaction = originalTransaction;
  });
  return calls;
}

const deletionToken = ({ crossEventReview = false } = {}) => {
  const impact = {
    eventId,
    eventName: "Service test event",
    status: "COMPLETED",
    version: 1,
    counts: { registrations: 0, queues: 0, screenings: 0, reviews: crossEventReview ? 1 : 0, files: 0, emails: 0, cleanup: 0, reports: 0 },
    blockers: crossEventReview ? [{ code: "EVENT_DELETE_INTEGRITY_CONFLICT", message: "This event has cross-event records and cannot be deleted safely" }] : [],
  };
  return eventService.__deletionTest.signDeletionPreview({
    eventId,
    adminId: manager.userId,
    version: 1,
    impactDigest: eventService.__deletionTest.impactDigest(impact),
    expiresAt: Date.now() + 60_000,
  });
};

test("terminal event deletion removes event-owned records and preserves the admin audit ledger", async (t) => {
  const calls = installDeletionTransaction(t);
  const administrator = { ...manager, roles: ["ADMINISTRATOR"] };

  const result = await eventService.deleteEvent(eventId, {
    version: 1,
    confirmationName: "Service test event",
    acknowledgePermanentDeletion: true,
    previewToken: deletionToken(),
  }, administrator, crypto.randomUUID());

  assert.deepEqual(result, { eventId, deleted: true, cleanupState: "COMPLETED" });
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
  assert.equal(ledger.details.status, "COMPLETED");
  assert.equal(ledger.details.version, 1);
  assert.ok(calls.some(([name]) => name === "registrations"));
  assert.ok(calls.some(([name]) => name === "stations"));
  assert.deepEqual(calls.find(([name]) => name === "syncActions")[1], { where: { OR: [{ eventId }] } });
  assert.ok(calls.findIndex(([name]) => name === "syncActions") < calls.findIndex(([name]) => name === "event.delete"));
  assert.equal(calls.some(([name]) => name === "eventAudit"), true);
  assert.equal(calls.some(([name]) => name === "audit.deleteScope"), false);
});

test("event audit schema matches the retained-history migration", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8");
  const retainedHistoryMigration = fs.readFileSync(
    path.join(__dirname, "../../prisma/migrations/20260803090000_preserve_event_audit_history/migration.sql"),
    "utf8",
  );
  const eventModel = schema.match(/model Event \{[\s\S]*?\n\}/)?.[0] || "";
  const eventAuditModel = schema.match(/model EventAuditLog \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(retainedHistoryMigration, /DROP CONSTRAINT IF EXISTS "event_audit_logs_event_id_fkey"/);
  assert.match(eventAuditModel, /eventId\s+String\s+@map\("event_id"\)/);
  assert.doesNotMatch(eventAuditModel, /event\s+Event\??\s+@relation/);
  assert.doesNotMatch(eventModel, /auditLogs\s+EventAuditLog\[\]/);
});

test("terminal event deletion denies non-administrators and stale versions", async (t) => {
  await assert.rejects(
    eventService.deleteEvent(eventId, { version: 1, confirmationName: "Service test event", acknowledgePermanentDeletion: true, previewToken: deletionToken() }, { ...manager, systemRole: "EVENT_MANAGER", roles: ["EVENT_MANAGER"] }, crypto.randomUUID()),
    (error) => error.code === "FORBIDDEN",
  );

  const calls = installDeletionTransaction(t, { transactionVersion: 2 });
  await assert.rejects(
    eventService.deleteEvent(eventId, { version: 1, confirmationName: "Service test event", acknowledgePermanentDeletion: true, previewToken: deletionToken() }, { ...manager, roles: ["ADMINISTRATOR"] }, crypto.randomUUID()),
    (error) => error.code === "STALE_EVENT_VERSION",
  );
  assert.equal(calls.some(([name]) => name === "event.delete"), false);
});

test("terminal event deletion rejects cross-event review references before deleting children", async (t) => {
  const calls = installDeletionTransaction(t, { crossEventReview: true });
  await assert.rejects(
    eventService.deleteEvent(eventId, { version: 1, confirmationName: "Service test event", acknowledgePermanentDeletion: true, previewToken: deletionToken({ crossEventReview: true }) }, { ...manager, roles: ["ADMINISTRATOR"] }, crypto.randomUUID()),
    (error) => error.code === "EVENT_DELETE_BLOCKED",
  );
  assert.equal(calls.some(([name]) => ["documents", "referrals", "registrations", "event.delete"].includes(name)), false);
});
