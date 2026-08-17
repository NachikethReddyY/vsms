const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { validateRouteOverride } = require("../../services/screening/routeOverridePolicy");
const { replaceRoute } = require("../../services/screening/routeOverrideService");
const { reconcileAfterRouteOverride } = require("../../services/screening/routeProgressionService");
const { routeOverrideBody } = require("../../schemas/queueSchemas");

const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
const [eventId, registrationId, userId, a, b, c] = ids;
const d = crypto.randomUUID();
const e = crypto.randomUUID();
const completedAt = new Date("2026-08-12T09:00:00.000Z");
const station = (stationId, position, completed = false) => ({
  routeStepId: crypto.randomUUID(),
  registrationId,
  stationId,
  position,
  completedAt: completed ? completedAt : null,
  station: {
    stationId,
    stationName: `Station ${position}`,
    stationType: "CUSTOM",
    isActive: true,
    operationalStatus: "AVAILABLE",
  },
});
const steps = [station(a, 1, true), station(b, 2), station(c, 3), station(d, 4)];

test("full overrides preserve completed and current steps and retain every station exactly once", () => {
  assert.deepEqual(validateRouteOverride({
    steps,
    stationIds: [b, d, c],
    activeStationId: b,
    scope: "FULL",
  }).after, [a, b, d, c]);

  assert.throws(
    () => validateRouteOverride({ steps, stationIds: [c, b, d], activeStationId: b, scope: "FULL" }),
    (error) => error.code === "LOCKED_ROUTE_STEP",
  );
  assert.throws(
    () => validateRouteOverride({ steps, stationIds: [b, d, d], activeStationId: b, scope: "FULL" }),
    (error) => error.code === "INVALID_ROUTE_OVERRIDE",
  );
});

test("next-only overrides may select one later station but cannot reorder the remaining tail", () => {
  assert.doesNotThrow(() => validateRouteOverride({
    steps,
    stationIds: [b, d, c],
    activeStationId: b,
    scope: "NEXT_ONLY",
  }));
  assert.throws(
    () => validateRouteOverride({
      steps: [...steps, station(e, 5)],
      stationIds: [b, d, e, c],
      activeStationId: b,
      scope: "NEXT_ONLY",
    }),
    (error) => error.code === "NEXT_ROUTE_STEP_ONLY",
  );
});

test("skipping the active station keeps it in route history and selects the requested next station", () => {
  assert.deepEqual(validateRouteOverride({
    steps,
    stationIds: [d, b, c],
    activeStationId: b,
    scope: "NEXT_ONLY",
    skipActive: true,
  }).after, [a, b, d, c]);
});

test("the final active station may be skipped to clinical review", () => {
  const finalSteps = [station(a, 1, true), station(b, 2, true), station(c, 3, true), station(d, 4)];
  assert.deepEqual(validateRouteOverride({
    steps: finalSteps,
    stationIds: [d],
    activeStationId: d,
    scope: "NEXT_ONLY",
    skipActive: true,
  }).after, [a, b, c, d]);
});

test("route override request is strict, duplicate-free, versioned, and reason-allowlisted", () => {
  const valid = { stationIds: [a, b], reasonCode: "QUEUE_BALANCING", expectedVersion: 2 };
  assert.equal(routeOverrideBody.safeParse(valid).success, true);
  assert.equal(routeOverrideBody.safeParse({ ...valid, skipActive: true }).success, true);
  assert.equal(routeOverrideBody.safeParse({ ...valid, stationIds: [a, a] }).success, false);
  assert.equal(routeOverrideBody.safeParse({ ...valid, reasonCode: "FREE_TEXT" }).success, false);
  assert.equal(routeOverrideBody.safeParse({ ...valid, expectedVersion: 0 }).success, false);
  assert.equal(routeOverrideBody.safeParse({ ...valid, role: "ADMINISTRATOR" }).success, false);
});

const manager = {
  userId,
  systemRole: "EVENT_MANAGER",
  roles: ["EVENT_MANAGER"],
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
};

const serviceDb = ({ routeVersion = 3 } = {}) => {
  const state = { routeVersion, positions: new Map(steps.map((step) => [step.stationId, step.position])), completed: new Set([a]), audits: [], movements: [] };
  let activeQueue = { id: crypto.randomUUID(), registrationId, stationId: b, queueNumber: 12, status: "WAITING" };
  const tx = {
    event: { findUnique: async () => ({ eventId, status: "IN_PROGRESS", version: 1 }) },
    eventMembership: {
      findFirst: async () => ({
        id: crypto.randomUUID(),
        eventId,
        userId,
        status: "ACTIVE",
        roles: [{ role: "EVENT_MANAGER" }],
        user: { professionalCategory: "STAFF" },
      }),
    },
    eventRegistration: {
      findFirst: async ({ where }) => where.eventId === eventId ? ({ registrationId, eventId, registrationStatus: "CHECKED_IN", routeVersion: state.routeVersion }) : null,
      findUnique: async () => ({ registrationId, eventId, queueNumber: 12, registrationStatus: "CHECKED_IN", routeVersion: state.routeVersion }),
      updateMany: async ({ where }) => {
        if (where.routeVersion !== state.routeVersion) return { count: 0 };
        state.routeVersion += 1;
        return { count: 1 };
      },
    },
    registrationRouteStep: {
      findMany: async () => steps
        .map((step) => ({ ...step, position: state.positions.get(step.stationId), completedAt: state.completed.has(step.stationId) ? completedAt : null }))
        .sort((left, right) => left.position - right.position),
      updateMany: async ({ where }) => {
        if (where.stationId) {
          state.completed.add(where.stationId);
          return { count: 1 };
        }
        return { count: steps.length };
      },
      update: async ({ where, data }) => {
        state.positions.set(where.registrationId_stationId.stationId, data.position);
        return {};
      },
    },
    queueEntry: {
      findFirst: async () => ["WAITING", "CALLED", "IN_PROGRESS"].includes(activeQueue?.status) ? activeQueue : null,
      updateMany: async ({ data }) => {
        activeQueue = { ...activeQueue, ...data };
        return { count: 1 };
      },
      create: async ({ data }) => {
        activeQueue = { id: crypto.randomUUID(), ...data };
        return activeQueue;
      },
    },
    eventStationAvailability: { findFirst: async () => ({ isAvailable: true, startsAt: null, endsAt: null }) },
    queueMovement: { create: async ({ data }) => { state.movements.push(data); return data; } },
    auditLog: { create: async ({ data }) => { state.audits.push(data); return data; } },
  };
  return { db: { ...tx, $transaction: async (work) => work(tx) }, state };
};

test("manager override accepts an existing transaction, uses routeVersion CAS, and audits the order", async () => {
  const { db, state } = serviceDb();
  const { $transaction: _transaction, ...transactionClient } = db;
  const route = await replaceRoute({
    eventId,
    registrationId,
    stationIds: [b, d, c],
    reasonCode: "QUEUE_BALANCING",
    expectedVersion: 3,
    user: manager,
    db: transactionClient,
  });
  assert.equal(route.routeVersion, 4);
  assert.deepEqual(route.steps.map(({ stationId }) => stationId), [a, b, d, c]);
  assert.equal(route.currentStation.stationId, b);
  assert.equal(state.audits.length, 1);
  assert.deepEqual(state.audits[0].oldValue.stationIds, [a, b, c, d]);
  assert.deepEqual(state.audits[0].newValue.stationIds, [a, b, d, c]);
  assert.equal(state.audits[0].newValue.reasonCode, "QUEUE_BALANCING");
});

test("route skip closes the current queue and atomically joins the selected next station", async () => {
  const { db, state } = serviceDb();
  const route = await replaceRoute({
    eventId,
    registrationId,
    stationIds: [d, b, c],
    reasonCode: "PARTICIPANT_NEED",
    expectedVersion: 3,
    skipActive: true,
    user: manager,
    db,
  });
  assert.deepEqual(route.steps.map(({ stationId }) => stationId), [a, b, d, c]);
  assert.equal(route.steps.find(({ stationId }) => stationId === b).state, "COMPLETED");
  assert.equal(route.currentStation.stationId, d);
  assert.deepEqual(state.movements, [{
    registrationId,
    fromStationId: b,
    toStationId: d,
    movedBy: userId,
    movementReason: "PARTICIPANT_NEED",
  }]);
});

test("stale route version returns 409 with the latest safe route and performs no audit", async () => {
  const { db, state } = serviceDb({ routeVersion: 4 });
  await assert.rejects(
    replaceRoute({
      eventId,
      registrationId,
      stationIds: [b, d, c],
      reasonCode: "QUEUE_BALANCING",
      expectedVersion: 3,
      user: manager,
      db,
    }),
    (error) => error.status === 409
      && error.code === "ROUTE_VERSION_CONFLICT"
      && error.details.latestRoute.routeVersion === 4,
  );
  assert.equal(state.audits.length, 0);
});

test("a blocked route override delegates the first queue creation to route progression", async () => {
  let queue = null;
  let queueCreates = 0;
  const tx = {
    queueEntry: {
      findFirst: async () => queue,
      create: async ({ data }) => {
        queueCreates += 1;
        queue = { id: crypto.randomUUID(), ...data };
        return queue;
      },
    },
    eventStationAvailability: {
      findFirst: async () => ({ isAvailable: true, startsAt: null, endsAt: null }),
    },
    eventRegistration: {
      findUnique: async () => ({ registrationId, eventId, queueNumber: 9, registrationStatus: "CHECKED_IN" }),
    },
  };
  const created = await reconcileAfterRouteOverride({ tx, registrationId, eventId, nextStep: steps[2] });
  const replay = await reconcileAfterRouteOverride({ tx, registrationId, eventId, nextStep: steps[2] });
  assert.equal(created.stationId, c);
  assert.equal(replay.id, created.id);
  assert.equal(queueCreates, 1);
});

test("an in-progress screening cannot be skipped into another queue", async () => {
  const tx = {
    queueEntry: { findFirst: async () => ({ id: crypto.randomUUID(), registrationId, stationId: b, status: "IN_PROGRESS" }) },
  };
  await assert.rejects(
    reconcileAfterRouteOverride({ tx, registrationId, eventId, nextStep: steps[2], skipActive: true }),
    (error) => error.code === "QUEUE_ALREADY_IN_PROGRESS",
  );
});

test("skipping the final queue completes its route step without creating another queue", async () => {
  const activeQueue = { id: crypto.randomUUID(), registrationId, stationId: d, status: "WAITING" };
  let queueStatus = activeQueue.status;
  let completed = false;
  const tx = {
    queueEntry: {
      findFirst: async () => ({ ...activeQueue, status: queueStatus }),
      updateMany: async ({ data }) => { queueStatus = data.status; return { count: 1 }; },
    },
    registrationRouteStep: {
      updateMany: async () => { completed = true; return { count: 1 }; },
    },
  };
  const result = await reconcileAfterRouteOverride({ tx, registrationId, eventId, nextStep: null, skipActive: true });
  assert.equal(result, null);
  assert.equal(queueStatus, "SKIPPED");
  assert.equal(completed, true);
});
