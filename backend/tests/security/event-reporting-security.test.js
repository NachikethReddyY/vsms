const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const eventController = require("../../controllers/eventController");
const eventService = require("../../services/event/eventService");
const env = require("../../config/env");
const { createExportReceipt } = require("../../utils/storage/eventExportReceipt");
const { encodeCursor } = require("../../utils/http/cursor");

const eventId = "11111111-1111-4111-8111-111111111111";
const managerId = "22222222-2222-4222-8222-222222222222";
const staffId = "33333333-3333-4333-8333-333333333333";
const assignmentId = "44444444-4444-4444-8444-444444444444";
const assignedBy = "55555555-5555-4555-8555-555555555555";
const startsAt = new Date("2026-08-01T01:00:00.000Z");
const endsAt = new Date("2026-08-01T05:00:00.000Z");
const assignedAt = new Date("2026-07-31T01:00:00.000Z");
const approved = (userId, systemRole = "STAFF") => ({ userId, systemRole, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" });

const exportEvent = () => ({
  eventId,
  name: "Community screening",
  description: null,
  bannerKey: "COMMUNITY_SCREENING",
  artworkDataUrl: null,
  venue: "Community Centre",
  address: null,
  postalCode: null,
  timezone: "Asia/Singapore",
  startsAt,
  endsAt,
  capacity: 50,
  expectedAttendance: null,
  status: "DRAFT",
  version: 3,
  eventDays: [],
  stations: [],
  shifts: [],
  staffAssignments: [{
    id: assignmentId,
    eventId,
    stationId: null,
    shiftId: null,
    userId: staffId,
    assignedBy,
    assignedAt,
    assignmentRole: "SUPPORT",
    assignmentStatus: "ASSIGNED",
    status: "ASSIGNED",
    notes: "Front desk",
  }],
  registrations: [],
});

const reportingDb = (event = exportEvent()) => ({
  event: { findUnique: async () => event },
  eventRegistration: { count: async () => 0 },
  screeningResult: { count: async () => 0 },
  referral: { count: async () => 0 },
});

test("metrics exclude cancelled check-ins from the attendance population", async () => {
  const registrations = [
    { registrationStatus: "SIGNED_UP", checkedIn: true },
    { registrationStatus: "CANCELLED", checkedIn: true },
  ];
  const db = {
    eventRegistration: {
      count: async ({ where }) => registrations.filter((registration) => (
        (!where.registrationStatus?.not || registration.registrationStatus !== where.registrationStatus.not) &&
        (!where.registrationStatus?.in || where.registrationStatus.in.includes(registration.registrationStatus)) &&
        (where.checkedIn === undefined || registration.checkedIn === where.checkedIn)
      )).length,
    },
    screeningResult: { count: async () => 0 },
    referral: { count: async () => 0 },
  };

  const metrics = await eventService.metricsForEvent({ eventId, capacity: 10, expectedAttendance: null }, db);
  assert.equal(metrics.signupCount, 1);
  assert.equal(metrics.checkedInCount, 1);
  assert.equal(metrics.attendanceRatePercent, 100);
});

test("event list counts registrations without cancelled rows", async () => {
  let query;
  const persistedRegistrations = ["SIGNED_UP", "COMPLETED", "CANCELLED"];
  const db = {
    event: {
      findMany: async (input) => {
        query = input;
        const excludedStatus = input.include._count.select.registrations.where.registrationStatus.not;
        return [{
          ...exportEvent(),
          eventDays: [],
          shifts: [],
          stations: [],
          registrations: [{ registrationId: "66666666-6666-4666-8666-666666666666" }],
          _count: { registrations: persistedRegistrations.filter((status) => status !== excludedStatus).length },
          createdBy: null,
          cancelledBy: null,
        }];
      },
    },
  };

  const result = await eventService.listEvents({ limit: 25 }, approved(managerId, "ADMIN"), db);
  assert.equal(result.events[0].signupCount, 2);
  assert.equal(result.events[0].activeCapacityCount, 1);
  assert.deepEqual(query.include._count.select.registrations, {
    where: { registrationStatus: { not: "CANCELLED" } },
  });
});

test("support staff roster projection omits contact metadata and assignment notes", async () => {
  const row = {
    ...exportEvent(),
    createdByUserId: managerId,
    createdBy: { id: managerId, username: "manager", fullName: "Manager", email: "manager@example.test", sysRole: "EVENT_MANAGER", status: "ACTIVE" },
    cancelledBy: null,
    stations: [],
    registrations: [],
    _count: { registrations: 0 },
    shifts: [{
      shiftId: "66666666-6666-4666-8666-666666666666",
      name: "Welcome desk",
      startsAt,
      endsAt,
      requiredStaff: 1,
      status: "PLANNED",
      staffAssignments: [{
        id: assignmentId,
        userId: staffId,
        assignmentRole: "SUPPORT",
        status: "ASSIGNED",
        notes: "Private accommodation note",
        assignedUser: { id: staffId, username: "support", fullName: "Support Person", email: "support@example.test", sysRole: "STAFF", status: "ACTIVE" },
        station: null,
      }],
    }],
    memberships: [{ userId: staffId, roles: [{ role: "SUPPORT" }] }],
  };
  const db = { event: { findMany: async () => [row] } };

  const result = await eventService.listEvents({ limit: 25 }, approved(staffId), db);
  const assignment = result.events[0].shifts[0].staffAssignments[0];

  assert.deepEqual(assignment.user, { userId: staffId, username: "support", fullName: "Support Person" });
  assert.equal("notes" in assignment, false);
  assert.deepEqual(result.events[0].createdBy, { userId: managerId, username: "manager" });
});

test("clinical event metrics require event management access", async () => {
  const row = {
    ...exportEvent(),
    createdByUserId: managerId,
    createdBy: null,
    cancelledBy: null,
    stations: [],
    registrations: [],
    _count: { registrations: 0 },
    shifts: [{
      shiftId: "66666666-6666-4666-8666-666666666666",
      staffAssignments: [{ userId: staffId, assignmentRole: "SUPPORT", status: "ASSIGNED" }],
    }],
    memberships: [{ userId: staffId, roles: [{ role: "SUPPORT" }] }],
  };
  const db = { event: { findFirst: async () => row } };

  await assert.rejects(
    () => eventService.getEventMetrics(eventId, approved(staffId), db),
    (error) => error.status === 404,
  );
});

test("public projection excludes drafts and staff or attendee data", async () => {
  const draft = { ...exportEvent(), status: "DRAFT", eventDays: [], staffAssignments: [{ private: true }] };
  const db = {
    event: {
      findFirst: async ({ where }) => (where.status.in.includes(draft.status) ? draft : null),
    },
  };
  await assert.rejects(
    () => eventService.getPublicEvent(eventId, db),
    (error) => error.code === "EVENT_NOT_FOUND",
  );

  const published = { ...draft, status: "PUBLISHED" };
  db.event.findFirst = async ({ where }) => (where.status.in.includes(published.status) ? published : null);
  const result = await eventService.getPublicEvent(eventId, db);
  assert.deepEqual(Object.keys(result).sort(), [
    "address", "artworkDataUrl", "bannerKey", "capacity", "description", "endsAt", "eventDays",
    "eventId", "name", "postalCode", "startsAt", "status", "timezone", "venue",
  ]);
  assert.equal("staffAssignments" in result, false);
  assert.equal("registrations" in result, false);
});

test("assigned event managers can page through no-store attendee rows", async () => {
  let attendeeQuery;
  const rows = Array.from({ length: 51 }, (_, index) => ({
    registrationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    participantDisplayName: "Participant",
    registrationStatus: "SIGNED_UP",
    checkedIn: false,
    checkedInAt: null,
    queueNumber: index + 1,
    createdAt: startsAt,
    participant: { participantReference: `P-${index}` },
  }));
  const managerEvent = {
    eventId,
    createdByUserId: staffId,
    shifts: [{ staffAssignments: [{ userId: managerId, assignmentRole: "EVENT_MANAGER", status: "ASSIGNED" }] }],
    memberships: [{ userId: managerId, roles: [{ role: "EVENT_MANAGER" }] }],
  };
  const db = {
    event: { findFirst: async () => managerEvent },
    eventRegistration: {
      count: async () => rows.length,
      findMany: async (input) => {
        attendeeQuery = input;
        return rows;
      },
    },
  };

  const result = await eventService.listEventAttendees(eventId, {}, approved(managerId, "EVENT_MANAGER"), db);
  assert.equal(result.attendees.length, 50);
  assert.equal(attendeeQuery.take, 51);
  assert.equal(typeof result.nextCursor, "string");

  db.event.findFirst = async () => null;
  await assert.rejects(
    () => eventService.listEventAttendees(eventId, {}, approved(managerId, "EVENT_MANAGER"), db),
    (error) => error.code === "EVENT_NOT_FOUND",
  );
});

test("audit pagination uses the record id to avoid skipping timestamp ties", async () => {
  const createdAt = "2026-08-01T02:00:00.000Z";
  const auditId = "77777777-7777-4777-8777-777777777777";
  let auditQuery;
  const db = {
    event: { findFirst: async () => ({ ...exportEvent(), shifts: [], memberships: [{ userId: managerId, roles: [{ role: "EVENT_MANAGER" }] }] }) },
    auditLog: { findMany: async (input) => { auditQuery = input; return []; } },
  };
  const scope = `event-audit:${eventId}:50`;

  await eventService.getAuditLog(eventId, {
    limit: 50,
    cursor: encodeCursor({ scope, createdAt, id: auditId }),
  }, approved(managerId, "ADMIN"), db);

  assert.deepEqual(auditQuery.where, {
    AND: [
      { entityName: "Event", entityId: eventId },
      {
        OR: [
          { createdAt: { lt: new Date(createdAt) } },
          { createdAt: new Date(createdAt), id: { lt: auditId } },
        ],
      },
    ],
  });
});

test("reporting controllers set their public and private cache boundaries", async () => {
  const originalPublic = eventService.getPublicEvent;
  const originalMetrics = eventService.getEventMetrics;
  const response = () => ({
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; },
  });
  eventService.getPublicEvent = async () => ({ eventId });
  eventService.getEventMetrics = async () => ({ signupCount: 0 });
  try {
    const publicResponse = response();
    await eventController.publicGet({ params: { eventId } }, publicResponse);
    assert.equal(publicResponse.headers["Cache-Control"], "public, max-age=60");

    const metricsResponse = response();
    await eventController.metrics({ params: { eventId }, user: { userId: managerId } }, metricsResponse);
    assert.equal(metricsResponse.headers["Cache-Control"], "no-store");
  } finally {
    eventService.getPublicEvent = originalPublic;
    eventService.getEventMetrics = originalMetrics;
  }
});

test("event mutation controllers pass the sanitized request context", async () => {
  const context = {
    requestId: "66666666-6666-4666-8666-666666666666",
    deviceId: "77777777-7777-4777-8777-777777777777",
    ipAddress: "203.0.113.12",
    deviceName: "Planning tablet",
    userAgent: "sanitized-agent",
  };
  const originalTransition = eventService.transitionEvent;
  let receivedContext;
  eventService.transitionEvent = async (_eventId, _command, _body, _user, received) => {
    receivedContext = received;
    return { eventId };
  };
  const res = { json(value) { this.body = value; return this; } };

  try {
    await eventController.publish({ params: { eventId }, body: { version: 1 }, user: { userId: managerId }, context }, res);
    assert.equal(receivedContext, context);
  } finally {
    eventService.transitionEvent = originalTransition;
  }
});

test("export preserves essential cascade-deleted assignment fields with a stable hash", async () => {
  const db = reportingDb();
  const first = await eventService.exportSnapshot(eventId, db);
  const second = await eventService.exportSnapshot(eventId, db);
  assert.deepEqual(first.staffAssignments, [{
    id: assignmentId,
    eventId,
    stationId: null,
    shiftId: null,
    userId: staffId,
    assignedBy,
    assignedAt: assignedAt.toISOString(),
    assignmentRole: "SUPPORT",
    assignmentStatus: "ASSIGNED",
    status: "ASSIGNED",
  }]);
  assert.equal(eventService.exportHashFor(first), eventService.exportHashFor(second));
});

test("an export receipt does not bypass terminal deletion authority", async () => {
  const receipt = createExportReceipt({
    eventId,
    version: 3,
    actorUserId: managerId,
    exportHash: "b".repeat(64),
    secret: env.jwtAccessSecret,
  });
  await assert.rejects(
    () => eventService.deleteEvent(eventId, {
      version: 3,
      confirmationName: "Community screening",
      acknowledgePermanentDeletion: true,
      exportReceipt: receipt,
    }, { userId: managerId, systemRole: "EVENT_MANAGER", roles: ["EVENT_MANAGER"] }, "request-2"),
    (error) => error.code === "FORBIDDEN",
  );
});
