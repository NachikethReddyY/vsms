const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const eventService = require("../../services/event/eventService");
const { getOfflinePack, __test } = require("../../services/event/offlinePackService");
const { offlinePackHeaders } = require("../../schemas/eventSchemas");

const eventId = crypto.randomUUID();
const otherEventId = crypto.randomUUID();
const actorId = crypto.randomUUID();
const otherUserId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const otherStationId = crypto.randomUUID();
const shiftId = crypto.randomUUID();
const queueEntryId = crypto.randomUUID();
const queuedRegistrationId = crypto.randomUUID();
const now = new Date("2030-01-01T09:00:00.000Z");
const eventEnd = new Date("2030-01-01T18:00:00.000Z");
const shiftEnd = new Date("2030-01-01T12:00:00.000Z");
const user = {
  userId: actorId,
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
  systemRole: "STAFF",
};
const safeQueueStatus = {
  event: { eventId, name: "Community screening", status: "IN_PROGRESS", venue: "Community hall" },
  stations: [{
    stationId,
    workload: { WAITING: 1, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
    nextUp: {
      queueId: queueEntryId,
      queueNumber: 7,
      registrationId: queuedRegistrationId,
      participantDisplayName: "Queue Participant",
      isPriority: false,
    },
  }],
  totals: { WAITING: 1, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
  entries: [{
    id: queueEntryId,
    registrationId: queuedRegistrationId,
    participantDisplayName: "Queue Participant",
    participantReference: "P-2030-0007",
    stationId,
    stationName: "Visual acuity",
    stationType: "VISUAL_ACUITY",
    queueNumber: 7,
    status: "WAITING",
    isPriority: false,
  }],
};
const safeRouteProjection = [{
  registrationId: queuedRegistrationId,
  route: {
    status: "READY",
    routeVersion: 2,
    steps: [{
      stationId,
      stationName: "Visual acuity",
      stationType: "VISUAL_ACUITY",
      position: 1,
      state: "CURRENT",
    }],
    currentStation: {
      stationId,
      stationName: "Visual acuity",
      stationType: "VISUAL_ACUITY",
      position: 1,
      state: "CURRENT",
    },
    queue: { queueEntryId, stationId, queueNumber: 7, status: "WAITING" },
  },
}];

const eventRecord = (role) => ({
  eventId,
  name: "Community screening",
  description: "Safe event description",
  bannerKey: "COMMUNITY_SCREENING",
  artworkDataUrl: null,
  venue: "Community hall",
  address: "1 Safe Street",
  postalCode: "123456",
  timezone: "Asia/Singapore",
  startsAt: new Date("2030-01-01T08:00:00.000Z"),
  endsAt: eventEnd,
  capacity: 100,
  expectedAttendance: 80,
  status: "IN_PROGRESS",
  version: 1,
  createdAt: new Date("2029-12-01T00:00:00.000Z"),
  updatedAt: new Date("2029-12-02T00:00:00.000Z"),
  nric: "S1234567A",
  contactNumber: "+6599999999",
  qrBearerToken: "qr-secret",
  signature: "signature-secret",
  referralDocument: "referral-secret",
  eventDays: [],
  stations: [
    { stationId, stationName: "Visual acuity", stationType: "VISUAL_ACUITY", stationOrder: 1, isActive: true },
    { stationId: otherStationId, stationName: "Other station", stationType: "REFRACTION", stationOrder: 2, isActive: true },
  ],
  shifts: [{
    shiftId,
    name: "Morning",
    startsAt: new Date("2030-01-01T08:00:00.000Z"),
    endsAt: shiftEnd,
    requiredStaff: 2,
    status: "ACTIVE",
    staffAssignments: [
      {
        id: crypto.randomUUID(),
        assignmentRole: role,
        status: "CONFIRMED",
        notes: "Own instructions",
        assignedUser: { id: actorId, username: "actor", fullName: "Current Actor", email: "actor@example.test" },
        station: { stationId, stationName: "Visual acuity", stationType: "VISUAL_ACUITY", stationOrder: 1 },
      },
      {
        id: crypto.randomUUID(),
        assignmentRole: "SCREENER",
        status: "CONFIRMED",
        notes: "Other staff instructions",
        assignedUser: { id: otherUserId, username: "other", fullName: "Other Staff", email: "other@example.test" },
        station: { stationId: otherStationId, stationName: "Other station", stationType: "REFRACTION", stationOrder: 2 },
      },
    ],
  }],
  memberships: [
    { userId: actorId, user: { fullName: "Current Actor" }, roles: [{ role }] },
    { userId: otherUserId, user: { fullName: "Other Staff" }, roles: [{ role: "SCREENER" }] },
  ],
  registrations: [],
  _count: { registrations: 0 },
  createdBy: { id: otherUserId, username: "other", fullName: "Other Staff", email: "other@example.test" },
  cancelledBy: null,
});

const eventDb = (role) => ({
  event: {
    findFirst: async ({ where }) => {
      assert.equal(where.memberships.some.userId, actorId);
      return where.eventId === eventId ? eventRecord(role) : null;
    },
  },
  stationTemplate: { findMany: async () => [] },
});

const eventGetter = (role) => {
  const db = eventDb(role);
  return (requestedEventId, actor) => eventService.getEvent(requestedEventId, actor, db);
};

test("screener pack is event-scoped, duty-capped, and strips forbidden queue and staff fields", async () => {
  const calls = [];
  const deviceId = crypto.randomUUID();
  const authorization = {
    isAdministrator: () => false,
    requireEventRoleAndDuty: async (requestedEventId, _actor, role) => {
      calls.push(["duty", requestedEventId, role]);
      return { shiftId, stationId, assignmentRole: role };
    },
  };
  const screening = {
    listStations: async (requestedEventId) => {
      calls.push(["stations", requestedEventId]);
      return {
        event: { eventId: requestedEventId },
        stations: [
          {
            stationId,
            eventId,
            stationName: "Visual acuity",
            stationType: "VISUAL_ACUITY",
            stationOrder: 1,
            isActive: true,
            fieldSchemaSnapshot: [{ key: "od", type: "text" }],
            schemaVersion: 1,
            offlineAccessExpiresAt: shiftEnd.toISOString(),
            internalSecret: "station-secret",
          },
          { stationId: otherStationId, eventId: otherEventId, stationName: "Cross event" },
        ],
      };
    },
    listQueue: async (requestedEventId, requestedStationId) => {
      calls.push(["queue", requestedEventId, requestedStationId]);
      return {
        registrations: [{
          registrationId: crypto.randomUUID(),
          participantDisplayName: "Queue Participant",
          queueNumber: 7,
          status: "WAITING",
          nric: "T7654321Z",
          contactNumber: "+6588888888",
          qrBearerToken: "queue-token",
          participant: { dateOfBirth: "1970-01-01" },
          existingResult: {
            resultId: crypto.randomUUID(),
            overallFlag: "NORMAL",
            isFlagged: false,
            createdAt: now,
            resultData: { clinical: "secret" },
          },
        }],
      };
    },
  };
  const queue = {
    getEventQueueStatus: async (requestedEventId) => {
      calls.push(["queue-status", requestedEventId]);
      return safeQueueStatus;
    },
  };
  const loadRoutes = async (_db, requestedEventId, registrationIds) => {
    calls.push(["routes", requestedEventId, registrationIds]);
    return safeRouteProjection;
  };

  const pack = await getOfflinePack(
    eventId,
    user,
    { deviceId },
    { roles: new Set(["SCREENER"]) },
    { authorization, screening, queue, loadRoutes, getEvent: eventGetter("SCREENER"), now, secret: "x".repeat(32), randomUUID: () => crypto.randomUUID() },
  );

  assert.deepEqual(Object.keys(pack), ["schemaVersion", "packId", "generatedAt", "expiresAt", "event", "roles", "capabilities", "lease", "screening", "queue", "routes"]);
  assert.equal(pack.schemaVersion, 1);
  assert.match(pack.packId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pack.expiresAt, shiftEnd.toISOString());
  assert.deepEqual(pack.roles, ["SCREENER"]);
  assert.deepEqual(pack.capabilities, { screening: true, registration: false, queue: true, review: false, routeOverride: true });
  assert.deepEqual(pack.lease.payload, {
    schemaVersion: 1,
    packId: pack.packId,
    actorId,
    eventId,
    deviceId,
    issuedAt: pack.generatedAt,
    expiresAt: pack.expiresAt,
    roles: pack.roles,
    capabilities: pack.capabilities,
  });
  assert.equal(pack.lease.algorithm, "ES256");
  assert.match(pack.lease.keyId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    pack.lease.keyId,
    crypto.createHash("sha256").update(JSON.stringify(pack.lease.publicKey)).digest("base64url"),
  );
  assert.match(pack.lease.signature, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(__test.verifyLease(pack.lease), true);
  const tamperedLease = structuredClone(pack.lease);
  tamperedLease.payload.capabilities.review = true;
  assert.equal(__test.verifyLease(tamperedLease), false);
  assert.equal(pack.screening.stations.length, 1);
  assert.equal(pack.screening.stations[0].registrations[0].participantDisplayName, "Queue Participant");
  assert.equal(pack.event.shifts[0].staffAssignments.length, 1);
  assert.equal(pack.event.shifts[0].staffAssignments[0].user.userId, actorId);
  assert.equal(pack.event.eventTeam, undefined);
  assert.equal(pack.queue, safeQueueStatus);
  assert.equal(pack.routes, safeRouteProjection);
  assert.deepEqual(calls, [
    ["duty", eventId, "SCREENER"],
    ["stations", eventId],
    ["queue", eventId, stationId],
    ["queue-status", eventId],
    ["routes", eventId, [queuedRegistrationId]],
  ]);

  const serialized = JSON.stringify(pack);
  for (const forbidden of [
    "S1234567A", "+6599999999", "qr-secret", "signature-secret", "referral-secret",
    "Other Staff", "other@example.test", "T7654321Z", "+6588888888", "queue-token",
    "dateOfBirth", "resultData", "station-secret", "clinicalSummary", "contactNumber",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter the offline pack`);
  }
});

test("route projections are fetched once, event-scoped, and limited to requested queue registrations", async () => {
  let query;
  const routes = await __test.loadOfflineRoutes({
    eventRegistration: {
      findMany: async (received) => {
        query = received;
        return [{
          registrationId: queuedRegistrationId,
          routeVersion: 2,
          routeSteps: [{
            routeStepId: crypto.randomUUID(),
            stationId,
            position: 1,
            completedAt: null,
            station: {
              stationId,
              stationName: "Visual acuity",
              stationType: "VISUAL_ACUITY",
              isActive: true,
              operationalStatus: "AVAILABLE",
            },
          }],
          queueEntries: [{ id: queueEntryId, stationId, queueNumber: 7, status: "WAITING" }],
        }];
      },
    },
  }, eventId, [queuedRegistrationId, crypto.randomUUID()]);

  assert.equal(query.where.eventId, eventId);
  assert.equal(query.where.registrationId.in[0], queuedRegistrationId);
  assert.equal(query.select.queueEntries.take, 1);
  assert.deepEqual(routes, safeRouteProjection);
});

test("manager pack keeps event access, omits other staff, and canonical event visibility rejects another event", async () => {
  const authorization = {
    isAdministrator: () => false,
    requireEventRoleAndDuty: async () => { throw new Error("manager duty must not be queried"); },
  };
  const dependencies = {
    authorization,
    screening: { listStations: async () => { throw new Error("manager has no screening capability"); } },
    queue: { getEventQueueStatus: async () => safeQueueStatus },
    loadRoutes: async (_db, requestedEventId, registrationIds) => {
      assert.equal(requestedEventId, eventId);
      assert.deepEqual(registrationIds, [queuedRegistrationId]);
      return safeRouteProjection;
    },
    getEvent: eventGetter("EVENT_MANAGER"),
    now,
    secret: "x".repeat(32),
  };
  const managerAuthorization = { roles: new Set(["EVENT_MANAGER"]) };

  const pack = await getOfflinePack(eventId, user, { deviceId: crypto.randomUUID() }, managerAuthorization, dependencies);
  assert.equal(pack.expiresAt, eventEnd.toISOString());
  assert.deepEqual(pack.roles, ["EVENT_MANAGER"]);
  assert.deepEqual(pack.capabilities, { screening: false, registration: false, queue: true, review: false, routeOverride: true });
  assert.deepEqual(pack.screening.stations, []);
  assert.equal(pack.queue, safeQueueStatus);
  assert.equal(pack.routes, safeRouteProjection);
  assert.equal(pack.event.shifts[0].staffAssignments.length, 1);
  assert.equal(pack.event.shifts[0].staffAssignments[0].user.userId, actorId);
  assert.equal(JSON.stringify(pack).includes("Other Staff"), false);

  await assert.rejects(
    getOfflinePack(otherEventId, user, { deviceId: crypto.randomUUID() }, managerAuthorization, dependencies),
    (error) => error.code === "EVENT_NOT_FOUND",
  );
});

test("registration duty gets only selectable station metadata and an event-scoped provisional queue seed", async () => {
  const aggregateScopes = [];
  const authorization = {
    isAdministrator: () => false,
    requireEventRoleAndDuty: async (requestedEventId, _actor, role) => {
      assert.equal(requestedEventId, eventId);
      assert.equal(role, "REGISTRATION");
      return { shiftId, assignmentRole: role };
    },
  };
  const queue = {
    listRegistrationStations: async (requestedEventId) => {
      assert.equal(requestedEventId, eventId);
      return {
        stations: [
          {
            stationId,
            stationName: "Visual acuity",
            stationType: "VISUAL_ACUITY",
            stationOrder: 1,
            selectable: true,
            activeQueueCount: 4,
            participant: { nric: "must-not-pack" },
          },
          {
            stationId: otherStationId,
            stationName: "Paused station",
            stationType: "REFRACTION",
            stationOrder: 2,
            selectable: false,
          },
        ],
      };
    },
    getEventQueueStatus: async () => safeQueueStatus,
  };
  const db = {
    eventRegistration: {
      aggregate: async (query) => {
        aggregateScopes.push(query.where);
        return { _max: { queueNumber: 40 } };
      },
    },
    queueEntry: {
      aggregate: async (query) => {
        aggregateScopes.push(query.where);
        return { _max: { queueNumber: 42 } };
      },
    },
  };

  const pack = await getOfflinePack(
    eventId,
    user,
    { deviceId: crypto.randomUUID() },
    { roles: new Set(["REGISTRATION"]) },
    {
      authorization,
      queue,
      db,
      loadRoutes: async (_db, requestedEventId, registrationIds) => {
        assert.equal(requestedEventId, eventId);
        assert.deepEqual(registrationIds, [queuedRegistrationId]);
        return safeRouteProjection;
      },
      getEvent: eventGetter("REGISTRATION"),
      now,
      secret: "x".repeat(32),
    },
  );

  assert.deepEqual(pack.registration, {
    stations: [{ stationId, stationName: "Visual acuity", stationType: "VISUAL_ACUITY", stationOrder: 1 }],
    nextQueueNumber: 43,
  });
  assert.deepEqual(pack.screening.stations, []);
  assert.equal(pack.queue, safeQueueStatus);
  assert.equal(pack.routes, safeRouteProjection);
  assert.equal(pack.capabilities.routeOverride, true);
  assert.equal(pack.expiresAt, shiftEnd.toISOString());
  assert.deepEqual(aggregateScopes, [{ eventId }, { station: { eventId } }]);
  assert.equal(JSON.stringify(pack).includes("must-not-pack"), false);
  assert.equal(JSON.stringify(pack).includes("activeQueueCount"), false);
});

test("registration membership without current duty cannot receive registration pack data", async () => {
  let registrationQueried = false;
  const authorization = {
    isAdministrator: () => false,
    requireEventRoleAndDuty: async () => {
      throw Object.assign(new Error("no active shift"), { code: "CURRENT_DUTY_REQUIRED" });
    },
  };

  await assert.rejects(
    getOfflinePack(
      eventId,
      user,
      { deviceId: crypto.randomUUID() },
      { roles: new Set(["REGISTRATION"]) },
      {
        authorization,
        queue: { listRegistrationStations: async () => { registrationQueried = true; } },
        getEvent: eventGetter("REGISTRATION"),
        now,
        secret: "x".repeat(32),
      },
    ),
    (error) => error.code === "CURRENT_DUTY_REQUIRED",
  );
  assert.equal(registrationQueried, false);
});

test("support duty can cache its queue but cannot receive route override state", async () => {
  const authorization = {
    isAdministrator: () => false,
    requireEventRoleAndDuty: async (_eventId, _actor, role) => {
      assert.equal(role, "SUPPORT");
      return { shiftId, assignmentRole: role };
    },
  };
  const pack = await getOfflinePack(
    eventId,
    user,
    { deviceId: crypto.randomUUID() },
    { roles: new Set(["SUPPORT"]) },
    {
      authorization,
      queue: { getEventQueueStatus: async () => safeQueueStatus },
      loadRoutes: async () => assert.fail("support must not receive override routes"),
      getEvent: eventGetter("SUPPORT"),
      now,
      secret: "x".repeat(32),
    },
  );
  assert.equal(pack.capabilities.queue, true);
  assert.equal(pack.capabilities.routeOverride, false);
  assert.equal(pack.routes, undefined);
});

test("queue authorization denial omits the projection while unexpected queue failures surface", async () => {
  const authorization = {
    isAdministrator: () => false,
    requireEventRoleAndDuty: async () => { throw new Error("manager duty must not be queried"); },
  };
  const managerAuthorization = { roles: new Set(["EVENT_MANAGER"]) };
  const dependencies = {
    authorization,
    getEvent: eventGetter("EVENT_MANAGER"),
    now,
    secret: "x".repeat(32),
  };

  const denied = await getOfflinePack(
    eventId,
    user,
    { deviceId: crypto.randomUUID() },
    managerAuthorization,
    {
      ...dependencies,
      queue: { getEventQueueStatus: async () => { throw Object.assign(new Error("denied"), { code: "EVENT_ROLE_REQUIRED" }); } },
    },
  );
  assert.equal(denied.queue, undefined);

  await assert.rejects(
    getOfflinePack(
      eventId,
      user,
      { deviceId: crypto.randomUUID() },
      managerAuthorization,
      { ...dependencies, queue: { getEventQueueStatus: async () => { throw new Error("database unavailable"); } } },
    ),
    /database unavailable/,
  );
});

test("device header is required and the opaque pack id changes with its binding", async () => {
  assert.equal(offlinePackHeaders.safeParse({}).success, false);
  assert.equal(offlinePackHeaders.safeParse({ "x-device-id": "not-a-uuid" }).success, false);
  assert.equal(offlinePackHeaders.safeParse({ "x-device-id": crypto.randomUUID(), authorization: "Bearer token" }).success, true);

  const binding = {
    actorId,
    eventId,
    generatedAt: now.toISOString(),
    expiresAt: shiftEnd.toISOString(),
    nonce: "fixed",
    secret: "x".repeat(32),
  };
  const firstDevice = crypto.randomUUID();
  const secondDevice = crypto.randomUUID();
  const first = __test.packIdFor({ ...binding, deviceId: firstDevice });
  const second = __test.packIdFor({ ...binding, deviceId: secondDevice });
  assert.notEqual(first, second);
  assert.equal(first.includes(actorId), false);
  assert.equal(first.includes(firstDevice), false);
});

test("global administrator bypass remains online-only", async () => {
  await assert.rejects(
    getOfflinePack(
      eventId,
      { ...user, systemRole: "ADMIN" },
      { deviceId: crypto.randomUUID() },
      { membership: null, roles: new Set(["EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"]) },
      {
        authorization: { isAdministrator: () => true },
        getEvent: async () => { throw new Error("event data must not be packed"); },
        now,
        secret: "x".repeat(32),
      },
    ),
    (error) => error.code === "OFFLINE_ADMIN_UNAVAILABLE",
  );
});
