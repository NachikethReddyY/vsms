const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const bus = require("../../services/domain/domainEventBus");
const { registerDomainEventHandlers } = require("../../services/domain/domainEventHandlers");
const requestContext = require("../../middlewares/requestContext");

const uuid = () => crypto.randomUUID();
const makeEvent = (overrides = {}) => ({
  id: uuid(),
  type: "SCREENING_RESULT_RECORDED",
  aggregateType: "ScreeningResult",
  aggregateId: uuid(),
  correlationId: uuid(),
  actorUserId: uuid(),
  payload: { overallFlag: "NORMAL", eventId: uuid() },
  status: "PENDING",
  attemptCount: 0,
  maxAttempts: 5,
  nextAttemptAt: new Date(),
  claimedAt: null,
  claimToken: null,
  lastErrorCode: null,
  dispatchedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Fake prisma client. `rows` is a mutable array; every mutation path (claim,
// dispatch, fail, create) updates the in-memory row so findUniqueOrThrow and
// findMany always see the latest state.
function fakeClient(rows = []) {
  const auditRows = [];
  const client = {
    domainEvent: {
      create: async ({ data }) => {
        const row = makeEvent({ ...data, payload: data.payload });
        rows.push(row);
        return row;
      },
      findUniqueOrThrow: async ({ where }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error(`row ${where.id} not found`);
        return row;
      },
      findMany: async ({ where }) => {
        const now = new Date();
        const staleBefore = new Date(now.getTime() - bus.LEASE_MS);
        return rows.filter((row) => {
          const statusOk = (where.OR || []).some((clause) => {
            if (clause.status?.in?.includes(row.status)) {
              return row.nextAttemptAt <= now || (clause.claimedAt && row.claimedAt && row.claimedAt <= staleBefore);
            }
            if (clause.status?.in) return false;
            return true;
          });
          return statusOk;
        }).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
      },
      updateMany: async ({ where, data }) => {
        const idx = rows.findIndex((row) => {
          if (where.id !== undefined && row.id !== where.id) return false;
          if (where.claimToken !== undefined && row.claimToken !== where.claimToken) return false;
          if (where.status !== undefined && row.status !== where.status) return false;
          if (where.attemptCount !== undefined) {
            if (where.attemptCount.lt !== undefined && !(row.attemptCount < where.attemptCount.lt)) return false;
          }
          if (where.OR !== undefined) {
            const ok = where.OR.some((clause) => {
              if (clause.status?.in && !clause.status.in.includes(row.status)) return false;
              if (clause.nextAttemptAt?.lte !== undefined && row.nextAttemptAt > clause.nextAttemptAt.lte) return false;
              if (clause.claimedAt?.lte !== undefined && (!row.claimedAt || row.claimedAt > clause.claimedAt.lte)) return false;
              return true;
            });
            if (!ok) return false;
          }
          return true;
        });
        if (idx === -1) return { count: 0 };
        const row = rows[idx];
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && value.increment !== undefined) {
            row[key] += value.increment;
          } else if (value && typeof value === "object" && value.set !== undefined) {
            row[key] = value.set;
          } else {
            row[key] = value;
          }
        }
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        auditRows.push(data);
        return data;
      },
    },
  };
  return { client, rows, auditRows };
}

const tick = (ms) => new Date(Date.now() + ms);

test.afterEach(() => bus.resetHandlers());

test("emit validates event type, aggregate, and payload", async () => {
  const { client } = fakeClient();
  const circular = {};
  circular.self = circular;
  await assert.rejects(bus.emit({ client, aggregateType: "Event", aggregateId: uuid() }), { code: "DOMAIN_EVENT_TYPE_REQUIRED" });
  await assert.rejects(bus.emit({ client, type: "X", aggregateId: uuid() }), { code: "DOMAIN_EVENT_AGGREGATE_REQUIRED" });
  await assert.rejects(bus.emit({ client, type: "X", aggregateType: "Event" }), { code: "DOMAIN_EVENT_AGGREGATE_ID_REQUIRED" });
  await assert.rejects(bus.emit({ client, type: "X", aggregateType: "Event", aggregateId: uuid(), payload: [1, 2] }), { code: "DOMAIN_EVENT_PAYLOAD_INVALID" });
  await assert.rejects(bus.emit({ client, type: "X", aggregateType: "Event", aggregateId: uuid(), payload: { data: "x".repeat(9000) } }), { code: "DOMAIN_EVENT_PAYLOAD_TOO_LARGE" });
  await assert.rejects(bus.emit({ client, type: "X", aggregateType: "Event", aggregateId: uuid(), payload: circular }), { code: "DOMAIN_EVENT_PAYLOAD_INVALID" });
});

test("emit persists a row through the provided client", async () => {
  const { client, rows } = fakeClient();
  const aggregateId = uuid();
  const row = await bus.emit({ client, type: "REFERRAL_ISSUED", aggregateType: "Referral", aggregateId, payload: { version: 3 } });
  assert.equal(rows.length, 1);
  assert.equal(row.type, "REFERRAL_ISSUED");
  assert.equal(row.status, "PENDING");
  assert.equal(row.payload.version, 3);
});

test("request context correlation reaches worker logs and domain-event audit rows", async () => {
  const requestId = uuid();
  const secret = "clinical payload must not be logged";
  const { client, auditRows } = fakeClient();
  const workerLogs = [];
  const workerLogger = {
    info: (message, fields) => workerLogs.push({ level: "info", message, fields }),
    warn: (message, fields) => workerLogs.push({ level: "warn", message, fields }),
  };
  registerDomainEventHandlers(bus);
  const responseHeaders = {};
  const request = {
    ip: "127.0.0.1",
    get: (name) => name === "x-request-id" ? requestId : "",
  };
  requestContext(request, { setHeader: (name, value) => { responseHeaders[name] = value; } }, () => {});
  assert.equal(request.context.requestId, requestId);
  assert.equal(responseHeaders["x-request-id"], requestId);

  const row = await bus.emit({
    client,
    type: "EVENT_TRANSITIONED",
    aggregateType: "Event",
    aggregateId: uuid(),
    context: request.context,
    payload: { fromStatus: "DRAFT", toStatus: "PUBLISHED", command: "publish", secret },
  });
  const result = await bus.dispatchEvent(row, { prisma: client, logger: workerLogger });

  assert.equal(row.correlationId, requestId);
  assert.equal(result.event.correlationId, requestId);
  assert.equal(workerLogs.length, 1);
  assert.equal(workerLogs[0].message, "domain_event.dispatched");
  assert.equal(workerLogs[0].fields.requestId, requestId);
  assert.equal(workerLogs[0].fields.payload, undefined);
  assert.equal(JSON.stringify(workerLogs).includes(secret), false);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].requestId, requestId);
});

test("worker failure logs correlate safely without handler payload or message", async () => {
  const requestId = uuid();
  const secret = "identity payload must not be logged";
  const rows = [makeEvent({ correlationId: requestId, payload: { secret } })];
  const { client } = fakeClient(rows);
  const workerLogs = [];
  const workerLogger = {
    info: (message, fields) => workerLogs.push({ level: "info", message, fields }),
    warn: (message, fields) => workerLogs.push({ level: "warn", message, fields }),
  };
  bus.registerHandler(rows[0].type, async () => {
    const error = new Error(secret);
    error.code = "SAFE_FAILURE";
    throw error;
  });

  const result = await bus.dispatchEvent(rows[0], { prisma: client, logger: workerLogger });

  assert.equal(result.event.status, "FAILED");
  assert.equal(workerLogs.length, 1);
  assert.equal(workerLogs[0].message, "domain_event.handler_failed");
  assert.equal(workerLogs[0].fields.requestId, requestId);
  assert.equal(workerLogs[0].fields.message, undefined);
  assert.equal(workerLogs[0].fields.payload, undefined);
  assert.equal(JSON.stringify(workerLogs).includes(secret), false);
});

test("claim rejects events that are not claimable", async () => {
  const { client } = fakeClient();
  const dispatched = makeEvent({ status: "DISPATCHED" });
  const future = makeEvent({ nextAttemptAt: tick(60000) });
  const result = await bus.dispatchEvent(dispatched, { prisma: client });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "NOT_CLAIMABLE");
  const result2 = await bus.dispatchEvent(future, { prisma: client });
  assert.equal(result2.accepted, false);
  assert.equal(result2.reason, "NOT_CLAIMABLE");
});

test("dispatch runs every registered handler and marks the event dispatched", async () => {
  const rows = [makeEvent()];
  const { client } = fakeClient(rows);
  const calls = [];
  bus.registerHandler("SCREENING_RESULT_RECORDED", async ({ event, context }) => {
    calls.push({ id: event.id, contextEmit: typeof context.emit });
  });
  bus.registerHandler("SCREENING_RESULT_RECORDED", async () => calls.push({ second: true }));

  const result = await bus.dispatchEvent(rows[0], { prisma: client });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].contextEmit, "function");
  assert.equal(result.accepted, true);
  assert.equal(result.pending, false);
  assert.equal(result.event.status, "DISPATCHED");
  assert.equal(result.event.attemptCount, 1);
});

test("dispatch marks events with no registered handlers as dispatched", async () => {
  const rows = [makeEvent({ type: "UNOBSERVED_TYPE" })];
  const { client } = fakeClient(rows);
  const result = await bus.dispatchEvent(rows[0], { prisma: client });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, "NO_HANDLERS");
  assert.equal(result.event.status, "DISPATCHED");
});

test("handler failure queues a retry with backoff and keeps the error code", async () => {
  const startedAt = new Date();
  const now = () => startedAt;
  const rows = [makeEvent({ nextAttemptAt: startedAt })];
  const { client } = fakeClient(rows);
  bus.registerHandler("SCREENING_RESULT_RECORDED", async () => {
    const error = new Error("boom");
    error.code = "SCREENING_SYNC_FAILED";
    throw error;
  });

  const result = await bus.dispatchEvent(rows[0], { prisma: client, now });
  assert.equal(result.accepted, true);
  assert.equal(result.pending, true);
  assert.equal(result.reason, "RETRY_QUEUED");
  assert.equal(result.event.status, "FAILED");
  assert.equal(result.event.attemptCount, 1);
  assert.equal(result.event.lastErrorCode, "SCREENING_SYNC_FAILED");
  assert.ok(result.event.nextAttemptAt > startedAt);
});

test("event is dead-lettered once attempts are exhausted", async () => {
  const startedAt = new Date();
  const now = () => startedAt;
  const rows = [makeEvent({ attemptCount: 4, nextAttemptAt: startedAt })];
  const { client } = fakeClient(rows);
  bus.registerHandler("SCREENING_RESULT_RECORDED", async () => {
    throw new Error("persistent failure");
  });

  const result = await bus.dispatchEvent(rows[0], { prisma: client, now });
  assert.equal(result.reason, "DEAD_LETTER");
  assert.equal(result.event.status, "DEAD_LETTER");
  assert.equal(result.event.attemptCount, 5);
});

test("processing a batch returns a per-event summary", async () => {
  const rows = [makeEvent()];
  const { client } = fakeClient(rows);
  bus.registerHandler("SCREENING_RESULT_RECORDED", async () => {});
  const summary = await bus.processNextDomainEvents({ limit: 25 }, { prisma: client });
  assert.equal(summary.attempted, 1);
  assert.equal(summary.dispatched, 1);
  assert.equal(summary.retried, 0);
  assert.equal(summary.deadLettered, 0);
  assert.equal(summary.events[0].status, "DISPATCHED");
  assert.equal(summary.events[0].correlationId, rows[0].correlationId);
  assert.equal(rows[0].attemptCount, 1);
});

test("handler registry supports unregister and reset", async () => {
  const { client } = fakeClient();
  const handle = bus.registerHandler("EVENT_TRANSITIONED", async () => {});
  assert.equal(bus.handlersFor("EVENT_TRANSITIONED").length, 1);
  assert.equal(bus.unregisterHandler(handle), true);
  assert.equal(bus.handlersFor("EVENT_TRANSITIONED").length, 0);
  bus.registerHandler("EVENT_TRANSITIONED", async () => {});
  bus.resetHandlers();
  assert.equal(bus.handlersFor("EVENT_TRANSITIONED").length, 0);
  const rows = [makeEvent({ type: "EVENT_TRANSITIONED" })];
  const { client: client2 } = fakeClient(rows);
  const result = await bus.dispatchEvent(rows[0], { prisma: client2 });
  assert.equal(result.reason, "NO_HANDLERS");
});

test("chained events emitted from a handler route through the injected client", async () => {
  const rows = [makeEvent()];
  const { client } = fakeClient(rows);
  const emitted = [];
  bus.registerHandler("SCREENING_RESULT_RECORDED", async ({ context }) => {
    emitted.push(await context.emit({
      type: "SCREENING_FLAGGED",
      aggregateType: "ScreeningResult",
      aggregateId: uuid(),
      payload: { eventId: uuid() },
    }));
  });

  const result = await bus.dispatchEvent(rows[0], { prisma: client });
  assert.equal(result.event.status, "DISPATCHED");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "SCREENING_FLAGGED");
  assert.equal(rows.length, 2);
});

test("stale PROCESSING leases are reclaimed and unexpired ones are skipped", async () => {
  const startedAt = new Date();
  const now = () => startedAt;
  bus.registerHandler("SCREENING_RESULT_RECORDED", async () => {});

  const stale = makeEvent({ status: "PROCESSING", claimedAt: new Date(startedAt.getTime() - bus.LEASE_MS - 1000), nextAttemptAt: startedAt });
  const fresh = makeEvent({ status: "PROCESSING", claimedAt: startedAt, nextAttemptAt: startedAt });
  const rows = [stale, fresh];
  const { client } = fakeClient(rows);
  const results = [];
  for (const row of [stale, fresh]) {
    results.push(await bus.dispatchEvent(row, { prisma: client, now }));
  }
  assert.equal(results[0].event.status, "DISPATCHED");
  assert.equal(results[1].accepted, false);
});
