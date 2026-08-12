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

test("station template library falls back to system schemas without writing", async (t) => {
  const originalFindMany = prisma.stationTemplate.findMany;
  const originalUpdate = prisma.stationTemplate.update;
  const { SYSTEM_FIELD_SCHEMAS } = require("../../schemas/dynamicStationSchema");
  const template = {
    stationTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    templateKey: "VISUAL_ACUITY",
    stationType: "VISUAL_ACUITY",
    version: 1,
    name: "Visual acuity",
    description: null,
    defaultCapacity: 4,
    active: true,
    fieldSchema: null,
  };
  let writes = 0;
  prisma.stationTemplate.findMany = async () => [template];
  prisma.stationTemplate.update = async () => {
    writes += 1;
    return {
      ...template,
      fieldSchema: SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY,
    };
  };
  t.after(() => {
    prisma.stationTemplate.findMany = originalFindMany;
    prisma.stationTemplate.update = originalUpdate;
  });

  const [catalog] = await eventService.listStationTemplates();
  const [library] = await eventService.listStationTemplateLibrary();

  assert.equal(writes, 0);
  assert.equal(catalog.fieldSchema, null);
  assert.deepEqual(library.fieldSchema, SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY);
});

test("station template mutations generate opaque keys and audit atomically", async () => {
  const audits = [];
  const transactionClient = {
    stationTemplate: {
      create: async ({ data }) => ({
        ...data,
        stationTemplateId: crypto.randomUUID(),
        version: 1,
      }),
      findUnique: async () => ({
        stationTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        templateKey: "opaque-existing-key",
        stationType: "VISUAL_ACUITY",
        version: 1,
        name: "Visual acuity booth",
        description: null,
        defaultCapacity: 4,
        active: true,
        fieldSchema: [{ key: "od", label: "OD", type: "text", required: true }],
      }),
      update: async ({ data }) => ({
        stationTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        templateKey: "opaque-existing-key",
        stationType: "VISUAL_ACUITY",
        version: 2,
        name: data.name ?? "Visual acuity booth",
        description: null,
        defaultCapacity: 4,
        active: data.active ?? true,
        fieldSchema: [{ key: "od", label: "OD", type: "text", required: true }],
      }),
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  const db = { $transaction: async (callback) => callback(transactionClient) };
  const context = { requestId: crypto.randomUUID(), ipAddress: "127.0.0.1", deviceName: "Test" };
  const body = { stationType: "VISUAL_ACUITY", name: "Visual acuity booth", defaultCapacity: 4, active: true };

  const first = await eventService.createStationTemplate(body, manager, context, db);
  const second = await eventService.createStationTemplate({ ...body, name: "Second visual acuity booth" }, manager, context, db);
  await eventService.updateStationTemplate(first.stationTemplateId, { name: "Updated visual acuity booth" }, manager, context, db);
  await eventService.updateStationTemplate(first.stationTemplateId, { active: false }, manager, context, db);

  assert.notEqual(first.templateKey, second.templateKey);
  assert.equal(first.stationType, "VISUAL_ACUITY");
  assert.ok(Array.isArray(first.fieldSchema) && first.fieldSchema.length > 0);
  assert.deepEqual(audits.map(({ action }) => action), [
    "STATION_TEMPLATE_CREATED",
    "STATION_TEMPLATE_CREATED",
    "STATION_TEMPLATE_UPDATED",
    "STATION_TEMPLATE_DEACTIVATED",
  ]);
  assert.ok(audits.every((audit) => audit.userId === manager.userId && audit.requestId === context.requestId));
});

test("clinical station templates reject fieldSchema on create and update", async () => {
  const createDb = { $transaction: async () => { throw new Error("transaction must not run"); } };
  const context = { requestId: crypto.randomUUID(), ipAddress: "127.0.0.1", deviceName: "Test" };
  await assert.rejects(
    () => eventService.createStationTemplate({
      stationType: "VISUAL_ACUITY",
      name: "Edited VA form",
      defaultCapacity: 2,
      active: true,
      fieldSchema: [{ key: "hacked", label: "Hacked", type: "text", required: true }],
    }, manager, context, createDb),
    (error) => error.code === "FIELD_SCHEMA_NOT_EDITABLE",
  );

  const transactionClient = {
    stationTemplate: {
      findUnique: async () => ({
        stationTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        templateKey: "opaque-existing-key",
        stationType: "VISUAL_ACUITY",
        version: 1,
        name: "Visual acuity booth",
        description: null,
        defaultCapacity: 4,
        active: true,
        fieldSchema: null,
      }),
      update: async () => { throw new Error("update must not run"); },
    },
    auditLog: { create: async () => ({}) },
  };
  await assert.rejects(
    () => eventService.updateStationTemplate(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { fieldSchema: [{ key: "notes", label: "Notes", type: "text", required: false }] },
      manager,
      context,
      { $transaction: async (callback) => callback(transactionClient) },
    ),
    (error) => error.code === "FIELD_SCHEMA_NOT_EDITABLE",
  );
});

test("registration, clinical review, and eye health catalog templates cannot be updated", async () => {
  const context = { requestId: crypto.randomUUID(), ipAddress: "127.0.0.1", deviceName: "Test" };
  for (const templateKey of ["CLINICAL_REVIEW", "REGISTRATION", "EYE_HEALTH"]) {
    const transactionClient = {
      stationTemplate: {
        findUnique: async () => ({
          stationTemplateId: "60000000-0000-4000-8000-000000000004",
          templateKey,
          stationType: templateKey === "EYE_HEALTH" ? "EYE_HEALTH" : null,
          version: 1,
          name: templateKey === "REGISTRATION" ? "Registration" : templateKey === "EYE_HEALTH" ? "Eye health" : "Clinical review",
          description: null,
          defaultCapacity: 2,
          active: true,
          fieldSchema: null,
        }),
        update: async () => { throw new Error("update must not run"); },
      },
      auditLog: { create: async () => ({}) },
    };
    await assert.rejects(
      () => eventService.updateStationTemplate(
        "60000000-0000-4000-8000-000000000004",
        { name: "Edited workflow" },
        manager,
        context,
        { $transaction: async (callback) => callback(transactionClient) },
      ),
      (error) => error.code === "STATION_TEMPLATE_NOT_EDITABLE",
    );
  }
});

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

test("live events reject station and shift plan updates", async (t) => {
  const current = eventRecord("IN_PROGRESS", 3);
  const originalFindFirst = prisma.event.findFirst;
  const originalTransaction = prisma.$transaction;
  let transactionCalls = 0;
  prisma.event.findFirst = async () => current;
  prisma.$transaction = async () => {
    transactionCalls += 1;
    throw new Error("transaction must not run for locked live plan fields");
  };
  t.after(() => {
    prisma.event.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  });

  await assert.rejects(
    () => eventService.updateEvent(eventId, {
      version: 3,
      shifts: [{
        shiftId,
        name: "Live coverage",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        requiredStaff: 2,
        assignments: [],
      }],
    }, manager, crypto.randomUUID()),
    (error) => error.code === "EVENT_NOT_EDITABLE" && error.status === 409,
  );
  await assert.rejects(
    () => eventService.updateEvent(eventId, {
      version: 3,
      stations: [{
        stationTemplateId: crypto.randomUUID(),
        stationOrder: 1,
        capacity: 4,
        isAvailable: true,
        availabilities: [],
      }],
    }, manager, crypto.randomUUID()),
    (error) => error.code === "EVENT_NOT_EDITABLE" && error.status === 409,
  );
  assert.equal(transactionCalls, 0);
});

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
    stationType: "VISUAL_ACUITY",
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

function installDeletionTransaction(t, { transactionVersion = 1, crossEventReview = false, status = "COMPLETED", participantIds = [], participantDeleteCount = participantIds.length } = {}) {
  const originalFindUnique = prisma.event.findUnique;
  const originalTransaction = prisma.$transaction;
  const originalCleanupFindMany = prisma.artifactCleanupTask.findMany;
  const calls = [];
  const remove = (name) => ({ deleteMany: async (input) => { calls.push([name, input]); return { count: 1 }; } });
  const current = eventRecord(status);
  prisma.event.findUnique = async () => current;
  prisma.artifactCleanupTask.findMany = async () => [];
  prisma.$transaction = async (callback) => callback({
    event: {
      findUnique: async () => ({ ...current, version: transactionVersion }),
      updateMany: async (input) => { calls.push(["event.update", input]); return { count: 1 }; },
      deleteMany: async (input) => { calls.push(["event.delete", input]); return { count: 1 }; },
    },
    eventRegistration: { findMany: async () => [], ...remove("registrations") },
    participant: {
      findMany: async (input) => { calls.push(["participants.findDeletable", input]); return participantIds.map((id) => ({ id })); },
      updateMany: async (input) => { calls.push(["participants.clearOnboardingEvent", input]); return { count: 1 }; },
      deleteMany: async (input) => { calls.push(["participants.delete", input]); return { count: participantDeleteCount }; },
    },
    participantEventIntake: remove("participantIntakes"),
    participantEmergencyContact: remove("participantEmergencyContacts"),
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

const deletionToken = ({ crossEventReview = false, status = "COMPLETED", participantCount = 0 } = {}) => {
  const impact = {
    eventId,
    eventName: "Service test event",
    status,
    version: 1,
    counts: { participants: participantCount, registrations: 0, queues: 0, screenings: 0, reviews: crossEventReview ? 1 : 0, files: 0, emails: 0, cleanup: 0, reports: 0 },
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

test("event deletion removes event-owned participant profiles and preserves shared profiles and the admin audit ledger", async (t) => {
  const participantId = crypto.randomUUID();
  const calls = installDeletionTransaction(t, { participantIds: [participantId] });
  const administrator = { ...manager, roles: ["ADMINISTRATOR"] };

  const result = await eventService.deleteEvent(eventId, {
    version: 1,
    confirmationName: "Service test event",
    acknowledgePermanentDeletion: true,
    previewToken: deletionToken({ participantCount: 1 }),
  }, administrator, crypto.randomUUID());

  assert.deepEqual(result, { eventId, deleted: true, cleanupState: "COMPLETED" });
  assert.deepEqual(calls.find(([name]) => name === "participants.clearOnboardingEvent")[1], {
    where: { onboardingEventId: eventId },
    data: { onboardingEventId: null },
  });
  assert.deepEqual(calls.find(([name]) => name === "participants.findDeletable")[1].where, {
    onboardingEventId: eventId,
    eventRegistrations: { none: { eventId: { not: eventId } } },
    eventIntakes: { none: { eventId: { not: eventId } } },
    consents: { none: { eventId: { not: eventId } } },
  });
  assert.deepEqual(calls.find(([name]) => name === "participants.delete")[1].where, {
    id: { in: [participantId] },
    onboardingEventId: eventId,
    eventRegistrations: { none: {} },
    eventIntakes: { none: {} },
    consents: { none: {} },
  });
  assert.ok(calls.findIndex(([name]) => name === "participantEmergencyContacts") < calls.findIndex(([name]) => name === "participants.delete"));
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

test("administrator can permanently delete a draft event with a matching signed preview", async (t) => {
  const calls = installDeletionTransaction(t, { status: "DRAFT" });
  const result = await eventService.deleteEvent(eventId, {
    version: 1,
    confirmationName: "Service test event",
    acknowledgePermanentDeletion: true,
    previewToken: deletionToken({ status: "DRAFT" }),
  }, { ...manager, roles: ["ADMINISTRATOR"] }, crypto.randomUUID());

  assert.equal(result.deleted, true);
  assert.deepEqual(calls.find(([name]) => name === "event.delete")[1].where, {
    eventId,
    version: 2,
    status: "DRAFT",
  });
});

test("event deletion rolls back when a participant becomes shared after preview", async (t) => {
  const participantId = crypto.randomUUID();
  const calls = installDeletionTransaction(t, { participantIds: [participantId], participantDeleteCount: 0 });

  await assert.rejects(
    eventService.deleteEvent(eventId, {
      version: 1,
      confirmationName: "Service test event",
      acknowledgePermanentDeletion: true,
      previewToken: deletionToken({ participantCount: 1 }),
    }, { ...manager, roles: ["ADMINISTRATOR"] }, crypto.randomUUID()),
    (error) => error.code === "DELETION_IMPACT_CHANGED",
  );
  assert.equal(calls.some(([name]) => name === "event.delete"), false);
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
