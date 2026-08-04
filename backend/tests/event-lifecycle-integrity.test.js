const test = require("node:test");
const assert = require("node:assert/strict");
const eventService = require("../services/eventService");
const { createEventBody } = require("../schemas/eventSchemas");

const eventId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const user = { userId, systemRole: "EVENT_MANAGER" };

function eventRecord(status, version, shifts = []) {
  return {
    eventId,
    name: "Community screening",
    description: null,
    venue: "Library hall",
    timezone: "Asia/Singapore",
    startsAt: new Date("2026-08-10T01:00:00.000Z"),
    endsAt: new Date("2026-08-10T09:00:00.000Z"),
    capacity: 100,
    expectedAttendance: 80,
    status,
    version,
    createdByUserId: userId,
    createdBy: { id: userId, username: "manager", email: "manager@example.test", sysRole: "EVENT_MANAGER", status: "ACTIVE" },
    cancelledBy: null,
    eventDays: [],
    stations: [],
    shifts,
    registrations: [],
    _count: { registrations: 0 },
  };
}

function transactionDb(current, updated, handlers = {}) {
  const tx = {
    event: {
      updateMany: handlers.updateEvent || (async () => ({ count: 1 })),
      findUniqueOrThrow: async () => updated,
    },
    shift: { updateMany: async () => ({ count: 0 }) },
    staffAssignment: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: handlers.audit || (async () => ({})) },
    ...handlers.tx,
  };
  return {
    event: { findFirst: async () => current },
    $transaction: async (callback) => callback(tx),
  };
}

test("event lifecycle commands use the real primary key and retain management access", async () => {
  const assignedShift = { shiftId: "44444444-4444-4444-8444-444444444444", staffAssignments: [{ userId, status: "ASSIGNED" }] };
  const current = { ...eventRecord("DRAFT", 1, [assignedShift]), stations: [{ stationId: "55555555-5555-4555-8555-555555555555", isActive: true }] };
  const updated = eventRecord("PUBLISHED", 2);
  let updateWhere;
  let audit;
  const db = transactionDb(current, updated, {
    updateEvent: async ({ where }) => { updateWhere = where; return { count: 1 }; },
    audit: async ({ data }) => { audit = data; return {}; },
  });

  const result = await eventService.transitionEvent(eventId, "publish", { version: 1 }, user, { requestId, ipAddress: "203.0.113.8", deviceName: "Event laptop" }, db);

  assert.deepEqual(updateWhere, { eventId, version: 1, status: "DRAFT" });
  assert.equal(audit.entityId, eventId);
  assert.equal(audit.requestId, requestId);
  assert.equal(audit.ipAddress, "203.0.113.8");
  assert.equal(audit.deviceName, "Event laptop");
  assert.equal(result.canManage, true);
  assert.equal(result.status, "PUBLISHED");

  const cancelling = eventRecord("PUBLISHED", 2);
  const cancelled = { ...eventRecord("CANCELLED", 3), cancellationReason: "Venue is no longer available" };
  let cancelWhere;
  const cancelDb = transactionDb(cancelling, cancelled, {
    updateEvent: async ({ where }) => { cancelWhere = where; return { count: 1 }; },
  });
  const cancelResult = await eventService.cancelEvent(eventId, { version: 2, reason: "Venue is no longer available" }, user, requestId, cancelDb);
  assert.deepEqual(cancelWhere, { eventId, version: 2, status: "PUBLISHED" });
  assert.equal(cancelResult.status, "CANCELLED");
  assert.equal(cancelResult.canManage, true);
});

test("publishing requires a station and an assigned person", async () => {
  const emptyPlan = eventRecord("DRAFT", 1);
  const missingStation = eventRecord("DRAFT", 1, [{ shiftId: "44444444-4444-4444-8444-444444444444", staffAssignments: [{ userId, status: "ASSIGNED" }] }]);
  const missingPerson = { ...eventRecord("DRAFT", 1), stations: [{ stationId: "55555555-5555-4555-8555-555555555555", isActive: true }] };
  for (const current of [emptyPlan, missingStation, missingPerson]) {
    await assert.rejects(
      () => eventService.transitionEvent(eventId, "publish", { version: 1 }, user, { requestId }, transactionDb(current, current)),
      (error) => error.code === "EVENT_NOT_READY" && error.status === 422,
    );
  }
});

test("event creation persists the selected event days", async () => {
  const saved = {
    ...eventRecord("DRAFT", 1),
    eventDays: [{
      eventDayId: "66666666-6666-4666-8666-666666666666",
      date: new Date("2026-08-10T00:00:00.000Z"),
      startsAt: new Date("2026-08-10T01:00:00.000Z"),
      endsAt: new Date("2026-08-10T09:00:00.000Z"),
    }],
  };
  const createdDays = [];
  const tx = {
    event: {
      create: async () => ({ ...saved, eventDays: [] }),
      findUniqueOrThrow: async () => saved,
    },
    eventDay: {
      create: async ({ data }) => { createdDays.push(data); return { eventDayId: saved.eventDays[0].eventDayId, ...data }; },
    },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (callback) => callback(tx) };

  const result = await eventService.createEvent({
    name: saved.name,
    description: null,
    venue: saved.venue,
    timezone: saved.timezone,
    startsAt: saved.startsAt.toISOString(),
    endsAt: saved.endsAt.toISOString(),
    capacity: saved.capacity,
    expectedAttendance: saved.expectedAttendance,
    eventDays: [{ date: "2026-08-10", startsAt: saved.startsAt.toISOString(), endsAt: saved.endsAt.toISOString() }],
    stations: [],
    shifts: [],
  }, user, requestId, null, db);

  assert.equal(createdDays.length, 1);
  assert.equal(createdDays[0].eventId, eventId);
  assert.equal(result.eventDays[0].date, "2026-08-10");
});

test("event creation rejects day slots outside the overall schedule", async () => {
  const body = {
    name: "Community screening",
    description: null,
    bannerKey: "COMMUNITY_SCREENING",
    artworkDataUrl: null,
    venue: "Library hall",
    address: null,
    postalCode: null,
    latitude: null,
    longitude: null,
    locationProvider: "MANUAL",
    locationReference: null,
    timezone: "Asia/Singapore",
    startsAt: "2026-08-10T01:00:00.000Z",
    endsAt: "2026-08-10T09:00:00.000Z",
    capacity: 100,
    expectedAttendance: 80,
    eventDays: [{
      date: "2026-08-10",
      startsAt: "2026-08-10T00:00:00.000Z",
      endsAt: "2026-08-10T09:00:00.000Z",
    }],
    stations: [],
    shifts: [],
  };
  const db = { $transaction: async (callback) => callback({ event: {} }) };

  await assert.rejects(
    () => eventService.createEvent(body, user, { requestId }, null, db),
    (error) => error.code === "INVALID_EVENT_DAY_RANGE",
  );
});

test("event plans reject duplicate station orders", () => {
  const station = (stationTemplateId) => ({
    stationTemplateId,
    stationOrder: 1,
    capacity: 10,
    isAvailable: true,
    availabilities: [],
  });
  const result = createEventBody.safeParse({
    name: "Community screening",
    venue: "Library hall",
    timezone: "Asia/Singapore",
    startsAt: "2026-08-10T01:00:00.000Z",
    endsAt: "2026-08-10T09:00:00.000Z",
    capacity: 100,
    stations: [
      station("55555555-5555-4555-8555-555555555555"),
      station("66666666-6666-4666-8666-666666666666"),
    ],
    shifts: [],
  });

  assert.equal(result.success, false);
  assert.match(result.error.issues.find((issue) => issue.path[0] === "stations").message, /order must be unique/);
});

test("simple event edits bypass unavailable station models", async () => {
  const current = eventRecord("DRAFT", 1);
  const updated = { ...eventRecord("DRAFT", 2), address: "100 Victoria Street", postalCode: "188064" };
  let updateData;
  const db = transactionDb(current, updated, {
    updateEvent: async ({ data }) => { updateData = data; return { count: 1 }; },
  });

  const result = await eventService.updateEvent(eventId, {
    version: 1,
    address: "100 Victoria Street",
    postalCode: "188064",
    expectedAttendance: 90,
    stations: [],
  }, user, requestId, db);

  assert.equal(updateData.address, "100 Victoria Street");
  assert.equal(updateData.expectedAttendance, 90);
  assert.equal(result.canManage, true);
});

test("staff removal checks and increments the event version before deleting", async () => {
  const shiftId = "44444444-4444-4444-8444-444444444444";
  const assignmentId = "55555555-5555-4555-8555-555555555555";
  const assignment = { id: assignmentId, userId, assignmentRole: "SUPPORT", status: "ASSIGNED", assignedUser: { id: userId }, station: null };
  const current = eventRecord("DRAFT", 7, [{ shiftId, name: "Morning", startsAt: new Date(), endsAt: new Date(), requiredStaff: 1, status: "PLANNED", staffAssignments: [assignment] }]);
  const updated = eventRecord("DRAFT", 8, [{ ...current.shifts[0], staffAssignments: [] }]);
  const calls = [];
  let versionWhere;
  const db = transactionDb(current, updated, {
    updateEvent: async ({ where }) => { calls.push("version"); versionWhere = where; return { count: 1 }; },
    tx: {
      staffAssignment: {
        findFirst: async () => ({ id: assignmentId }),
        delete: async () => { calls.push("delete"); return {}; },
      },
    },
  });

  const result = await eventService.removeStaffAssignment(eventId, shiftId, assignmentId, 7, user, requestId, db);

  assert.deepEqual(versionWhere, { eventId, version: 7 });
  assert.deepEqual(calls, ["version", "delete"]);
  assert.equal(result.version, 8);
  assert.equal(result.canManage, true);
});

test("staff assignment commits with schedule locking and the event version", async () => {
  const shiftId = "44444444-4444-4444-8444-444444444444";
  const stationId = "55555555-5555-4555-8555-555555555555";
  const assigneeId = "66666666-6666-4666-8666-666666666666";
  const shift = {
    shiftId,
    name: "Morning",
    startsAt: new Date("2026-08-10T01:00:00.000Z"),
    endsAt: new Date("2026-08-10T05:00:00.000Z"),
    requiredStaff: 1,
    status: "PLANNED",
    staffAssignments: [],
  };
  const station = { stationId, stationName: "Visual acuity", stationType: "VISUAL_ACUITY", stationOrder: 1, isActive: true };
  const current = { ...eventRecord("DRAFT", 3, [shift]), stations: [station] };
  const assignment = {
    id: "77777777-7777-4777-8777-777777777777",
    userId: assigneeId,
    assignmentRole: "SCREENER",
    status: "ASSIGNED",
    notes: "Arrive early",
    assignedUser: { id: assigneeId, username: "screener" },
    station,
  };
  const updated = { ...eventRecord("DRAFT", 4, [{ ...shift, staffAssignments: [assignment] }]), stations: [station] };
  let versionWhere;
  let createdAssignment;
  let audit;
  const db = transactionDb(current, updated, {
    updateEvent: async ({ where }) => { versionWhere = where; return { count: 1 }; },
    audit: async ({ data }) => { audit = data; return {}; },
    tx: {
      $executeRawUnsafe: async () => 1,
      user: { findFirst: async () => ({ id: assigneeId }) },
      staffAssignment: {
        findFirst: async () => null,
        create: async ({ data }) => { createdAssignment = data; return assignment; },
      },
    },
  });

  const result = await eventService.addStaffAssignment(eventId, shiftId, {
    version: 3,
    userId: assigneeId,
    assignmentRole: "SCREENER",
    eventStationId: stationId,
    notes: "Arrive early",
  }, user, { requestId, ipAddress: "203.0.113.9", deviceName: "Planner" }, db);

  assert.deepEqual(versionWhere, { eventId, version: 3 });
  assert.equal(createdAssignment.stationId, stationId);
  assert.equal(createdAssignment.assignmentStatus, "ASSIGNED");
  assert.equal(createdAssignment.status, "ASSIGNED");
  assert.equal(audit.action, "STAFF_ASSIGNMENT_ADDED");
  assert.equal(audit.requestId, requestId);
  assert.equal(result.shifts[0].staffAssignments[0].user.username, "screener");
});
