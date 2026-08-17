const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const AppError = require("../../errors/AppError");
const { syncOperationsBody } = require("../../schemas/screeningSchemas");
const queueService = require("../../services/screening/queueService");
const { processSyncOperations } = require("../../services/screening/syncService");

const eventId = crypto.randomUUID();
const queueId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const routeRegistrationId = crypto.randomUUID();
const routeStationIds = [stationId, crypto.randomUUID()];
const user = {
  userId: crypto.randomUUID(),
  roles: ["EVENT_MANAGER"],
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
};

const queueAction = (overrides = {}) => ({
  type: "QUEUE_CALL",
  clientActionId: crypto.randomUUID(),
  queueId,
  expectedStatus: "WAITING",
  ...overrides,
});

const routeAction = (overrides = {}) => ({
  type: "ROUTE_OVERRIDE",
  clientActionId: crypto.randomUUID(),
  registrationId: routeRegistrationId,
  stationIds: routeStationIds,
  reasonCode: "QUEUE_BALANCING",
  expectedVersion: 3,
  skipActive: false,
  ...overrides,
});

const createLedgerDb = () => {
  const rows = [];
  const transitions = [];
  const db = {
    rows,
    transitions,
    $transaction: async (callback) => callback(db),
    syncAction: {
      findFirst: async ({ where }) => structuredClone(rows.find((row) => (
        row.userId === where.userId && row.clientActionId === where.clientActionId
      )) || null),
      findUnique: async ({ where }) => structuredClone(rows.find((row) => row.id === where.id) || null),
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), errorCode: null, responseSnapshot: null, ...structuredClone(data) };
        rows.push(row);
        return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const row = rows.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
        if (!row) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          row[key] = value && typeof value === "object" && "increment" in value
            ? row[key] + value.increment
            : structuredClone(value);
        }
        return { count: 1 };
      },
    },
    syncActionTransition: {
      create: async ({ data }) => {
        transitions.push(structuredClone(data));
        return data;
      },
    },
  };
  return db;
};

const invoke = (db, action, queue) => processSyncOperations(
  eventId,
  { clientBatchId: crypto.randomUUID(), actions: [action] },
  user,
  { requestId: crypto.randomUUID() },
  { db, queue, audit: async () => {} },
);

test("queue operations apply once, replay a safe receipt, and keep priority notes out of the ledger", async () => {
  const db = createLedgerDb();
  const action = queueAction({
    type: "QUEUE_PRIORITY",
    expectedStatus: "WAITING",
    payload: { isPriority: true, notes: "Participant disclosed a sensitive condition" },
  });
  let applies = 0;
  let authorizations = 0;
  const queue = {
    authorizeQueueSyncAction: async () => { authorizations += 1; },
    applySyncedQueueAction: async () => {
      applies += 1;
      return {
        id: queueId,
        status: "WAITING",
        isPriority: true,
        priorityNotes: action.payload.notes,
      };
    },
  };

  const first = await invoke(db, action, queue);
  const replay = await invoke(db, action, queue);

  assert.equal(applies, 1);
  assert.equal(authorizations, 2, "current authorization must be checked on exact replay");
  assert.deepEqual(first.actions[0], replay.actions[0]);
  assert.deepEqual(first.actions[0].result, { queueId, status: "WAITING", isPriority: true });
  assert.deepEqual(db.rows[0].payload, {
    schemaVersion: 1,
    actionType: "QUEUE_PRIORITY",
    expectedStatus: "WAITING",
  });
  assert.equal(JSON.stringify(db.rows).includes(action.payload.notes), false);
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "APPLIED"]);
});

test("queue authorization is checked before a durable ledger row is created", async () => {
  const db = createLedgerDb();
  const queue = {
    authorizeQueueSyncAction: async () => { throw new AppError(403, "CURRENT_DUTY_REQUIRED", "Duty expired"); },
    applySyncedQueueAction: async () => assert.fail("must not apply"),
  };
  await assert.rejects(invoke(db, queueAction(), queue), (error) => error.code === "CURRENT_DUTY_REQUIRED");
  assert.equal(db.rows.length, 0);
});

test("the full operation batch is authorized before its first action applies", async () => {
  const db = createLedgerDb();
  const allowed = queueAction();
  const denied = queueAction({ queueId: crypto.randomUUID() });
  const queue = {
    authorizeQueueSyncAction: async (_eventId, action) => {
      if (action.clientActionId === denied.clientActionId) {
        throw new AppError(403, "CURRENT_DUTY_REQUIRED", "Duty expired");
      }
    },
    applySyncedQueueAction: async () => assert.fail("must not apply a partially authorized batch"),
  };
  await assert.rejects(processSyncOperations(
    eventId,
    { clientBatchId: crypto.randomUUID(), actions: [allowed, denied] },
    user,
    null,
    { db, queue, audit: async () => {} },
  ), (error) => error.code === "CURRENT_DUTY_REQUIRED");
  assert.equal(db.rows.length, 0);
});

test("a stale queue status is recorded as an allowlisted conflict", async () => {
  const db = createLedgerDb();
  const queue = {
    authorizeQueueSyncAction: async () => {},
    applySyncedQueueAction: async () => {
      throw new AppError(409, "QUEUE_STATE_CONFLICT", "Changed on another device");
    },
  };
  const response = await invoke(db, queueAction(), queue);
  assert.equal(response.actions[0].status, "CONFLICT");
  assert.equal(response.actions[0].errorCode, "QUEUE_STATE_CONFLICT");
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "CONFLICT"]);
});

test("queue operation schema is a strict transition-specific union", () => {
  const batch = (action) => ({ clientBatchId: crypto.randomUUID(), actions: [action] });
  for (const action of [
    queueAction(),
    queueAction({ type: "QUEUE_START", expectedStatus: "CALLED" }),
    queueAction({ type: "QUEUE_SKIP", expectedStatus: "CALLED" }),
    queueAction({ type: "QUEUE_PRIORITY", expectedStatus: "IN_PROGRESS", payload: { isPriority: false, notes: null } }),
  ]) {
    assert.equal(syncOperationsBody.safeParse(batch(action)).success, true);
  }
  for (const action of [
    queueAction({ expectedStatus: "CALLED" }),
    queueAction({ payload: { isPriority: true, notes: "not valid for call" } }),
    queueAction({ type: "QUEUE_PRIORITY", payload: { isPriority: true, notes: null } }),
    queueAction({ type: "QUEUE_PRIORITY", payload: { isPriority: true, notes: "Reason", extra: true } }),
  ]) {
    assert.equal(syncOperationsBody.safeParse(batch(action)).success, false);
  }
});

test("offline queue writes use an atomic expected-status predicate", async () => {
  let current = {
    id: queueId,
    stationId,
    status: "WAITING",
    isPriority: false,
    registration: { eventId },
  };
  let casWhere = null;
  const tx = {
    queueEntry: {
      findUnique: async () => structuredClone(current),
      updateMany: async ({ where, data }) => {
        casWhere = where;
        if (current.status !== where.status) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }) => data },
  };
  const db = {
    event: { findUnique: async () => ({ eventId, status: "IN_PROGRESS" }) },
    eventMembership: {
      findFirst: async () => ({ roles: [{ role: "EVENT_MANAGER" }], user }),
    },
    station: { findFirst: async () => ({ stationId, eventId, isActive: true }) },
    queueEntry: { findUnique: async () => structuredClone(current) },
    $transaction: async (callback) => callback(tx),
  };

  const result = await queueService.callQueueEntry(queueId, user, null, db, eventId, "WAITING");
  assert.deepEqual(casWhere, { id: queueId, status: "WAITING" });
  assert.equal(result.status, "CALLED");

  current = { ...current, status: "WAITING" };
  tx.queueEntry.updateMany = async () => ({ count: 0 });
  await assert.rejects(
    queueService.callQueueEntry(queueId, user, null, db, eventId, "WAITING"),
    (error) => error.code === "QUEUE_STATE_CONFLICT" && error.status === 409,
  );
});

test("route overrides apply once, replay a safe route receipt, and keep the proposal out of the ledger", async () => {
  const db = createLedgerDb();
  const action = routeAction();
  let applies = 0;
  let authorizations = 0;
  const routeOverride = {
    getRoute: async () => { authorizations += 1; },
    replaceRoute: async ({ db: transactionDb }) => {
      applies += 1;
      assert.equal(transactionDb, db, "the route mutation and SyncAction receipt share one transaction");
      return {
        status: "READY",
        routeVersion: 4,
        steps: routeStationIds.map((id, index) => ({
          stationId: id,
          stationName: `Station ${index + 1}`,
          stationType: "CUSTOM",
          position: index + 1,
          state: index === 0 ? "CURRENT" : "UPCOMING",
          internalSecret: "must-not-receipt",
        })),
        currentStation: {
          stationId,
          stationName: "Station 1",
          stationType: "CUSTOM",
          position: 1,
          state: "CURRENT",
        },
        queue: { queueEntryId: queueId, stationId, queueNumber: 7, status: "WAITING" },
        internalSecret: "must-not-receipt",
      };
    },
  };
  const invokeRoute = () => processSyncOperations(
    eventId,
    { clientBatchId: crypto.randomUUID(), actions: [action] },
    user,
    null,
    { db, routeOverride, audit: async () => {} },
  );

  const first = await invokeRoute();
  const replay = await invokeRoute();

  assert.equal(applies, 1);
  assert.equal(authorizations, 2, "current route authority must be checked on exact replay");
  assert.deepEqual(first.actions[0], replay.actions[0]);
  assert.equal(first.actions[0].result.routeVersion, 4);
  assert.equal(JSON.stringify(first.actions[0]).includes("must-not-receipt"), false);
  assert.deepEqual(db.rows[0].payload, {
    schemaVersion: 1,
    actionType: "ROUTE_OVERRIDE",
    expectedVersion: 3,
  });
  assert.equal(JSON.stringify(db.rows[0].payload).includes("QUEUE_BALANCING"), false);
  assert.equal(JSON.stringify(db.rows[0].payload).includes(routeStationIds[1]), false);
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "APPLIED"]);
});

test("route version conflicts remain a durable allowlisted conflict", async () => {
  const db = createLedgerDb();
  const action = routeAction();
  const routeOverride = {
    getRoute: async () => {},
    replaceRoute: async () => {
      throw new AppError(409, "ROUTE_VERSION_CONFLICT", "Changed on another device");
    },
  };
  const response = await processSyncOperations(
    eventId,
    { clientBatchId: crypto.randomUUID(), actions: [action] },
    user,
    null,
    { db, routeOverride, audit: async () => {} },
  );
  assert.equal(response.actions[0].status, "CONFLICT");
  assert.equal(response.actions[0].errorCode, "ROUTE_VERSION_CONFLICT");
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "CONFLICT"]);
});

test("route authority and event scope are checked before a durable ledger row is created", async () => {
  const db = createLedgerDb();
  const routeOverride = {
    getRoute: async () => { throw new AppError(403, "CURRENT_DUTY_REQUIRED", "Duty expired"); },
    replaceRoute: async () => assert.fail("must not apply"),
  };
  await assert.rejects(
    processSyncOperations(
      eventId,
      { clientBatchId: crypto.randomUUID(), actions: [routeAction()] },
      user,
      null,
      { db, routeOverride, audit: async () => {} },
    ),
    (error) => error.code === "CURRENT_DUTY_REQUIRED",
  );
  assert.equal(db.rows.length, 0);
});

test("route override sync schema is strict, duplicate-free, versioned, and reason-allowlisted", () => {
  const batch = (action) => ({ clientBatchId: crypto.randomUUID(), actions: [action] });
  assert.equal(syncOperationsBody.safeParse(batch(routeAction())).success, true);
  for (const action of [
    routeAction({ stationIds: [stationId, stationId] }),
    routeAction({ reasonCode: "FREE_TEXT" }),
    routeAction({ expectedVersion: 0 }),
    (() => { const { skipActive: _skipActive, ...missing } = routeAction(); return missing; })(),
    routeAction({ unexpected: true }),
  ]) {
    assert.equal(syncOperationsBody.safeParse(batch(action)).success, false);
  }
});
