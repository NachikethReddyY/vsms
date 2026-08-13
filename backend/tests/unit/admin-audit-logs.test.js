const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const adminController = require("../../controllers/adminController");
const { encodeCursor } = require("../../utils/http/cursor");

function replace(t, target, key, value) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

const auditRow = (overrides = {}) => ({
  id: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  action: "SCREENING_RESULT_RECORDED",
  entityName: "ScreeningResult",
  entityId: crypto.randomUUID(),
  outcome: "SUCCESS",
  createdAt: new Date("2026-08-01T00:00:03.000Z"),
  ipAddress: "127.0.0.1",
  deviceName: "Unit Test",
  details: null,
  newValue: null,
  oldValue: null,
  requestId: null,
  deviceId: null,
  user: null,
  ...overrides,
});

const authLogRow = (overrides = {}) => ({
  id: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  eventType: "LOGIN_SUCCESS",
  outcome: "SUCCESS",
  occurredAt: new Date("2026-08-01T00:00:02.000Z"),
  ipAddress: "127.0.0.1",
  userAgent: "unit-test",
  requestId: null,
  deviceId: null,
  failureCategory: null,
  identifierHash: null,
  user: null,
  ...overrides,
});

const eventLogRow = (overrides = {}) => ({
  eventAuditLogId: crypto.randomUUID(),
  eventId: crypto.randomUUID(),
  actorUserId: crypto.randomUUID(),
  action: "UPDATED",
  beforeSnapshot: { status: "DRAFT" },
  afterSnapshot: { status: "PUBLISHED" },
  correlationId: crypto.randomUUID(),
  createdAt: new Date("2026-08-01T00:00:01.000Z"),
  actor: null,
  ...overrides,
});

const callGetAuditLogs = async (query) => {
  const req = { query };
  const res = {
    statusCode: 200,
    json: (body) => { res.body = body; return res; },
  };
  await new Promise((resolve) => {
    const next = (error) => { res.error = error; resolve(); };
    res.json = (body) => { res.body = body; resolve(); return res; };
    adminController.getAuditLogs(req, res, next);
  });
  if (res.error) throw res.error;
  return res.body;
};

test("admin audit history merges application, authentication, and event ledgers chronologically", async (t) => {
  replace(t, prisma.auditLog, "findMany", async () => [auditRow()]);
  replace(t, prisma.authAuditLog, "findMany", async () => [authLogRow()]);
  replace(t, prisma.eventAuditLog, "findMany", async () => [eventLogRow()]);

  const body = await callGetAuditLogs({ limit: 50 });

  assert.deepEqual(body.items.map(({ source }) => source), ["APPLICATION", "AUTHENTICATION", "EVENT"]);
  assert.deepEqual(body.items.map(({ action }) => action), ["SCREENING_RESULT_RECORDED", "LOGIN_SUCCESS", "UPDATED"]);
  assert.equal(body.items[2].entityName, "Event");
  assert.equal(body.nextCursor, null);
});

test("admin audit history applies application filters and skips unrelated ledgers", async (t) => {
  const captured = [];
  replace(t, prisma.auditLog, "findMany", async (args) => {
    captured.push(args);
    return [auditRow()];
  });
  replace(t, prisma.authAuditLog, "findMany", async () => assert.fail("auth ledger should be skipped"));
  replace(t, prisma.eventAuditLog, "findMany", async () => assert.fail("event ledger should be skipped"));

  const body = await callGetAuditLogs({
    entityName: "ScreeningResult",
    action: "SCREENING_RESULT_RECORDED",
    outcome: "SUCCESS",
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-08-31T00:00:00.000Z"),
    limit: 50,
  });

  assert.equal(body.items.length, 1);
  assert.equal(captured[0].where.entityName, "ScreeningResult");
  assert.equal(captured[0].where.action, "SCREENING_RESULT_RECORDED");
  assert.equal(captured[0].where.outcome, "SUCCESS");
  assert.deepEqual(captured[0].where.createdAt, {
    gte: new Date("2026-07-01T00:00:00.000Z"),
    lte: new Date("2026-08-31T00:00:00.000Z"),
  });
  assert.equal(captured[0].take, 51);
});

test("admin audit history returns one signed cursor for the merged timeline", async (t) => {
  replace(t, prisma.auditLog, "findMany", async () => [
    auditRow(),
    auditRow({ createdAt: new Date("2026-08-01T00:00:00.000Z") }),
  ]);
  replace(t, prisma.authAuditLog, "findMany", async () => [authLogRow()]);
  replace(t, prisma.eventAuditLog, "findMany", async () => [eventLogRow()]);

  const body = await callGetAuditLogs({ limit: 2 });
  assert.equal(body.items.length, 2);
  assert.ok(body.nextCursor);
  assert.equal(Object.hasOwn(body, "nextAuthCursor"), false);
});

test("admin audit history rejects a tampered cursor with 422", async (t) => {
  replace(t, prisma.auditLog, "findMany", async () => []);
  replace(t, prisma.authAuditLog, "findMany", async () => []);
  replace(t, prisma.eventAuditLog, "findMany", async () => []);

  await assert.rejects(
    callGetAuditLogs({ cursor: "Y2FsbC5tZWNvLW1hZ2lrLm5ldA.tampered-signature", limit: 50 }),
    (error) => error.code === "INVALID_CURSOR" && error.status === 422,
  );
});

test("admin audit history rejects a valid cursor for the wrong filter scope", async (t) => {
  replace(t, prisma.auditLog, "findMany", async () => []);
  replace(t, prisma.authAuditLog, "findMany", async () => []);
  replace(t, prisma.eventAuditLog, "findMany", async () => []);
  const wrongScopeCursor = encodeCursor({
    scope: "some-other-scope",
    occurredAt: "2026-08-01T00:00:00.000Z",
    source: "APPLICATION",
    id: crypto.randomUUID(),
  });

  await assert.rejects(
    callGetAuditLogs({ cursor: wrongScopeCursor, limit: 50 }),
    (error) => error.code === "INVALID_CURSOR" && error.status === 422,
  );
});

test("admin audit history threads a valid merged cursor into every ledger query", async (t) => {
  const captured = [];
  replace(t, prisma.auditLog, "findMany", async (args) => {
    captured.push(args);
    return [auditRow(), auditRow({ createdAt: new Date("2026-08-01T00:00:00.000Z") })];
  });
  replace(t, prisma.authAuditLog, "findMany", async () => []);
  replace(t, prisma.eventAuditLog, "findMany", async () => []);

  const first = await callGetAuditLogs({ limit: 1 });
  assert.ok(first.nextCursor);
  await callGetAuditLogs({ cursor: first.nextCursor, limit: 1 });

  assert.ok(captured[1].where.AND);
  assert.equal(captured[1].orderBy[0].createdAt, "desc");
  assert.equal(captured[1].take, 2);
});
