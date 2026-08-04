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

const eventRecord = (status = "DRAFT", version = 1, assignments = []) => ({
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
  registrations: [],
  _count: { registrations: 0 },
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
    user: { findFirst: async () => ({ id: staffId }) },
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
