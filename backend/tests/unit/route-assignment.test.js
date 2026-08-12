const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const {
  assignCheckedInRegistration,
  assignRouteOnce,
} = require("../../services/screening/routeAssignmentService");
const { createInitialQueueEntry } = require("../../services/screening/routeProgressionService");

const registrationId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const station = (stationId, stationOrder, operationalStatus = "AVAILABLE") => ({
  stationId,
  stationName: `Station ${stationId}`,
  stationType: "CUSTOM",
  stationOrder,
  operationalStatus,
  stationTemplate: { defaultCapacity: 3 },
});

const routeDb = ({ stations, activeEntries = [], availabilities = [] }) => {
  const state = {
    routeSteps: [],
    queueEntries: [],
    queueNumber: null,
    routeCreates: 0,
    queueCreates: 0,
    stationReads: 0,
  };
  const tx = {
    eventRegistration: {
      findUnique: async () => ({
        registrationId,
        eventId,
        registeredBy: userId,
        checkedIn: true,
        registrationStatus: "CHECKED_IN",
        routeVersion: 1,
        queueNumber: state.queueNumber,
        event: { status: "IN_PROGRESS" },
      }),
      aggregate: async () => ({ _max: { queueNumber: 8 } }),
      update: async ({ data }) => {
        state.queueNumber = data.queueNumber;
        return {};
      },
    },
    registrationRouteStep: {
      findMany: async () => state.routeSteps.map((step) => ({
        ...step,
        completedAt: null,
        station: {
          stationName: stations.find(({ stationId }) => stationId === step.stationId).stationName,
          stationType: "CUSTOM",
        },
      })),
      createMany: async ({ data }) => {
        state.routeCreates += 1;
        state.routeSteps = data.map((step, index) => ({ routeStepId: `route-${index}`, ...step }));
        return { count: data.length };
      },
    },
    station: {
      findMany: async () => {
        state.stationReads += 1;
        return stations;
      },
    },
    queueEntry: {
      findMany: async () => activeEntries,
      findFirst: async () => state.queueEntries.find(({ status }) => ["WAITING", "CALLED", "IN_PROGRESS"].includes(status)) || null,
      create: async ({ data }) => {
        state.queueCreates += 1;
        const created = { id: `queue-${state.queueCreates}`, ...data };
        state.queueEntries.push(created);
        return created;
      },
    },
    eventStationAvailability: { findMany: async () => availabilities },
    auditLog: { create: async () => ({}) },
  };
  return { state, tx };
};

test("assignment persists one stable exact-load route and delegates the initial queue", async () => {
  const a = station("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1);
  const b = station("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2);
  const unavailable = station("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 3, "OFFLINE");
  const { state, tx } = routeDb({
    stations: [a, b, unavailable],
    activeEntries: [
      { stationId: a.stationId },
      { stationId: a.stationId },
      { stationId: b.stationId },
    ],
    availabilities: [
      { eventStationId: a.stationId, capacity: 4, isAvailable: true },
      { eventStationId: b.stationId, capacity: 4, isAvailable: true },
      { eventStationId: unavailable.stationId, capacity: 10, isAvailable: true },
    ],
  });

  const first = await assignRouteOnce({ tx, registrationId, eventId, actorUserId: userId });
  assert.deepEqual(first.steps.map(({ stationId }) => stationId), [b.stationId, a.stationId, unavailable.stationId]);
  assert.equal(first.status, "READY");
  assert.equal(first.currentStation.stationId, b.stationId);
  assert.equal(first.queue.queueNumber, 9);
  assert.equal(state.routeCreates, 1);
  assert.equal(state.queueCreates, 1);
  assert.equal(Object.hasOwn(first.steps[0], "routeStepId"), false);
  assert.equal(Object.hasOwn(first.steps[0], "activeQueueCount"), false);
  assert.equal(Object.hasOwn(first.steps[0], "capacity"), false);

  const second = await assignRouteOnce({ tx, registrationId, eventId, actorUserId: userId });
  assert.deepEqual(second.steps.map(({ stationId }) => stationId), first.steps.map(({ stationId }) => stationId));
  assert.equal(state.routeCreates, 1);
  assert.equal(state.queueCreates, 1);
  assert.equal(state.stationReads, 1);
});

test("assignment retains unavailable required steps but creates no false queue", async () => {
  const first = station("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1, "PAUSED");
  const second = station("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2, "OFFLINE");
  const { state, tx } = routeDb({ stations: [first, second] });

  const route = await assignRouteOnce({ tx, registrationId, eventId, actorUserId: userId });
  assert.equal(route.status, "NEEDS_STAFF_ACTION");
  assert.equal(route.steps.length, 2);
  assert.equal(route.steps[0].state, "BLOCKED");
  assert.equal(route.queue, null);
  assert.equal(state.queueCreates, 0);
});

test("assignment reports an in-progress event with no required stations", async () => {
  const { state, tx } = routeDb({ stations: [] });
  const route = await assignRouteOnce({ tx, registrationId, eventId, actorUserId: userId });
  assert.equal(route.status, "NO_SCREENING_STATIONS");
  assert.deepEqual(route.steps, []);
  assert.equal(state.routeCreates, 0);
  assert.equal(state.queueCreates, 0);
});

test("initial progression is idempotent and refuses a conflicting active queue", async () => {
  const expectedStation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherStation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const same = {
    id: "queue-1",
    registrationId,
    stationId: expectedStation,
    queueNumber: 4,
    status: "WAITING",
  };
  const tx = { queueEntry: { findFirst: async () => same } };
  assert.equal(await createInitialQueueEntry({ tx, registrationId, stationId: expectedStation }), same);

  await assert.rejects(
    createInitialQueueEntry({ tx, registrationId, stationId: otherStation }),
    (error) => error.code === "ROUTE_QUEUE_CONFLICT" && error.status === 409,
  );
});

test("checked-in backfill uses the same assign-once transaction and is idempotent", async () => {
  const first = station("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1);
  const { state, tx } = routeDb({ stations: [first] });
  tx.$queryRaw = async () => [{ registration_id: registrationId }];
  const db = { $transaction: async (work) => work(tx) };

  const initial = await assignCheckedInRegistration(registrationId, db);
  const replay = await assignCheckedInRegistration(registrationId, db);
  assert.equal(initial.status, "READY");
  assert.equal(replay.status, "READY");
  assert.equal(state.routeCreates, 1);
  assert.equal(state.queueCreates, 1);
});
