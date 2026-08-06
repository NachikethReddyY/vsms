const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const adminController = require("../../controllers/adminController");
const { encodeCursor } = require("../../utils/cursor");

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
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  ipAddress: "127.0.0.1",
  deviceName: "Unit Test",
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
  occurredAt: new Date("2026-08-01T00:00:00.000Z"),
  ipAddress: "127.0.0.1",
  userAgent: "unit-test",
  requestId: null,
  deviceId: null,
  failureCategory: null,
  identifierHash: null,
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

test("admin getAuditLogs applies entityName/action/outcome/date filters", async (t) => {
  const captured = [];
  replace(t, prisma.auditLog, "findMany", async (args) => {
    captured.push(args);
    return [auditRow()];
  });
  replace(t, prisma.authAuditLog, "findMany", async () => [authLogRow()]);

  const body = await callGetAuditLogs({
    entityName: "ScreeningResult",
    action: "SCREENING_RESULT_RECORDED",
    outcome: "SUCCESS",
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-08-31T00:00:00.000Z"),
    limit: 50,
  });

  assert.equal(body.logs.length, 1);
  assert.equal(body.authLogs.length, 1);
  const where = captured[0].where;
  assert.equal(where.entityName, "ScreeningResult");
  assert.equal(where.action, "SCREENING_RESULT_RECORDED");
  assert.equal(where.outcome, "SUCCESS");
  assert.deepEqual(where.createdAt, {
    gte: new Date("2026-07-01T00:00:00.000Z"),
    lte: new Date("2026-08-31T00:00:00.000Z"),
  });
  assert.equal(captured[0].take, 51);
});

test("admin getAuditLogs returns a nextCursor when more rows exist", async (t) => {
  replace(t, prisma.auditLog, "findMany", async () => [
    auditRow(),
    auditRow(),
    auditRow(),
  ]);
  replace(t, prisma.authAuditLog, "findMany", async () => [authLogRow()]);

  const body = await callGetAuditLogs({ limit: 2 });
  assert.equal(body.logs.length, 2);
  assert.ok(body.nextCursor);
  assert.equal(body.nextAuthCursor, null);
});

test("admin getAuditLogs rejects a tampered cursor with 422", async (t) => {
  replace(t, prisma.auditLog, "findMany", async () => [auditRow()]);
  replace(t, prisma.authAuditLog, "findMany", async () => [authLogRow()]);

  await assert.rejects(
    callGetAuditLogs({ cursor: "Y2FsbC5tZWNvLW1hZ2lrLm5ldA.tampered-signature" }),
    (error) => error.code === "INVALID_CURSOR" && error.status === 422,
  );
});

test("admin getAuditLogs rejects a valid cursor for the wrong scope with 422", async (t) => {
  replace(t, prisma.auditLog, "findMany", async () => [auditRow()]);
  replace(t, prisma.authAuditLog, "findMany", async () => [authLogRow()]);

  const wrongScopeCursor = encodeCursor({
    scope: "some-other-scope",
    createdAt: "2026-08-01T00:00:00.000Z",
    id: crypto.randomUUID(),
  });

  await assert.rejects(
    callGetAuditLogs({ cursor: wrongScopeCursor }),
    (error) => error.code === "INVALID_CURSOR" && error.status === 422,
  );
});

test("admin getAuditLogs threads a valid cursor into the keyset where clause", async (t) => {
  const captured = [];
  replace(t, prisma.auditLog, "findMany", async (args) => {
    captured.push(args);
    return [auditRow()];
  });
  replace(t, prisma.authAuditLog, "findMany", async () => [authLogRow()]);

  const cursor = encodeCursor({
    scope: "admin-audit",
    createdAt: "2026-08-01T00:00:00.000Z",
    id: crypto.randomUUID(),
  });

  await callGetAuditLogs({ cursor, limit: 50 });
  const where = captured[0].where;
  assert.ok(where.OR);
  assert.equal(captured[0].orderBy[0].createdAt, "desc");
  assert.equal(captured[0].take, 51);
});
