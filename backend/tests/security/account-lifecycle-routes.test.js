const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const cookieParser = require("cookie-parser");
const express = require("express");
const request = require("supertest");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const { signAccessToken } = require("../../utils/tokens");
const requireAuthentication = require("../../middlewares/requireAuthentication");
const requireApprovedAccount = require("../../middlewares/requireApprovedAccount");
const accountRoutes = require("../../routes/accountRoutes");
const adminRoutes = require("../../routes/adminRoutes");
const userRoutes = require("../../routes/userRoutes");
const accountService = require("../../services/account/accountService");
const userService = require("../../services/account/userService");

function appFor(user) {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async () => user;
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/account", accountRoutes);
  app.get("/operational", requireAuthentication, requireApprovedAccount, (_req, res) => res.json({ ok: true }));
  app.use("/admin", adminRoutes);
  app.use("/users", userRoutes);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
  return { app, restore: () => { prisma.user.findUnique = originalFindUnique; } };
}

const account = (state) => ({
  id: crypto.randomUUID(),
  email: `${state.toLowerCase()}@example.com`,
  fullName: `${state} Account`,
  status: state === "SUSPENDED" ? "SUSPENDED" : "INACTIVE",
  approvalState: state === "PENDING" ? "PENDING" : state === "REJECTED" ? "REJECTED" : "APPROVED",
  accessState: state === "SUSPENDED" ? "SUSPENDED" : "ENABLED",
  deprovisionedAt: null,
  sessionInvalidBefore: null,
  userRoles: [],
  eventMemberships: [],
});

test("pending, rejected, and suspended sessions have account access but no operational access", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });

  for (const state of ["PENDING", "REJECTED", "SUSPENDED"]) {
    const user = account(state);
    const { app, restore } = appFor(user);
    const authorization = `Bearer ${signAccessToken(user)}`;
    assert.equal((await request(app).get("/account").set("Authorization", authorization)).status, 200);
    assert.equal((await request(app).get("/operational").set("Authorization", authorization)).status, 403);
    restore();
  }
});

test("self-service route rejects authoritative employment and lifecycle fields", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });
  const user = account("PENDING");
  const { app, restore } = appFor(user);
  t.after(restore);
  const authorization = `Bearer ${signAccessToken(user)}`;

  for (const body of [
    { employeeNumber: "EMP-NEW" },
    { department: "Privileged" },
    { designation: "Administrator" },
    { approvalState: "APPROVED" },
    { accessState: "ENABLED" },
  ]) {
    const response = await request(app).patch("/account").set("Authorization", authorization).send(body);
    assert.equal(response.status, 422);
  }
});

test("admin account list rejects invalid pagination and filters before querying", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });
  const user = {
    ...account("APPROVED"),
    status: "ACTIVE",
    userRoles: [{ role: { roleName: "ADMINISTRATOR", rolePermissions: [] } }],
  };
  const { app, restore } = appFor(user);
  t.after(restore);
  const authorization = `Bearer ${signAccessToken(user)}`;

  for (const query of ["page=0", "limit=101", "approvalState=UNKNOWN", "unexpected=value"]) {
    const response = await request(app).get(`/admin/accounts?${query}`).set("Authorization", authorization);
    assert.equal(response.status, 422);
  }
});

test("new and legacy administrator routes both protect the final administrator", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });
  const actor = {
    ...account("APPROVED"),
    id: crypto.randomUUID(),
    status: "ACTIVE",
    userRoles: [{ role: { roleName: "ADMINISTRATOR", rolePermissions: [] } }],
  };
  const target = {
    ...actor,
    id: crypto.randomUUID(),
    email: "final-target@example.com",
    userRoles: [{ role: { id: crypto.randomUUID(), roleName: "ADMINISTRATOR" } }],
  };
  const originalFindUnique = prisma.user.findUnique;
  const originalTransaction = prisma.$transaction;
  prisma.user.findUnique = async () => actor;
  prisma.$transaction = async (callback) => callback({
    $executeRaw: async () => {},
    user: {
      findUnique: async () => target,
      count: async () => 1,
    },
    role: { findMany: async () => [{ id: crypto.randomUUID(), roleName: "REVIEWER" }] },
  });
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
    prisma.$transaction = originalTransaction;
  });
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/admin", adminRoutes);
  app.use("/users", userRoutes);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
  const authorization = `Bearer ${signAccessToken(actor)}`;

  const lifecycle = await request(app)
    .post(`/admin/accounts/${target.id}/reject`)
    .set("Authorization", authorization)
    .send({ reason: "Administrative transition" });
  assert.equal(lifecycle.status, 422);
  assert.equal(lifecycle.body.code, "LAST_ADMIN_CHANGE_BLOCKED");

  const legacy = await request(app)
    .patch(`/users/${target.id}`)
    .set("Authorization", authorization)
    .send({ roles: ["REVIEWER"] });
  assert.equal(legacy.status, 422);
  assert.equal(legacy.body.code, "LAST_ADMIN_CHANGE_BLOCKED");
});

test("account and legacy user controllers return accepted without changing entity response shapes", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });
  const actor = {
    ...account("APPROVED"),
    status: "ACTIVE",
    userRoles: [{ role: { roleName: "ADMINISTRATOR", rolePermissions: [] } }],
  };
  const targetId = crypto.randomUUID();
  const providerOperation = {
    id: crypto.randomUUID(),
    operationType: "SYNC_ACCESS",
    generation: 2,
    status: "PROCESSING",
    pending: true,
    reason: "LEASE_OWNED",
  };
  const originalChangeAccess = accountService.changeAccess;
  const originalCreateUser = userService.createUser;
  accountService.changeAccess = async () => ({
    id: targetId,
    fullName: "Queued Account",
    email: "queued@example.com",
    status: "ACTIVE",
    providerOperation,
  });
  userService.createUser = async () => ({
    id: targetId,
    fullName: "Queued Account",
    email: "queued@example.com",
    status: "ACTIVE",
    roles: ["SUPPORT"],
    providerOperation,
  });
  t.after(() => {
    accountService.changeAccess = originalChangeAccess;
    userService.createUser = originalCreateUser;
  });
  const { app, restore } = appFor(actor);
  t.after(restore);
  const authorization = `Bearer ${signAccessToken(actor)}`;

  const accountResponse = await request(app)
    .post(`/admin/accounts/${targetId}/reactivate`)
    .set("Authorization", authorization)
    .send({});
  assert.equal(accountResponse.status, 202);
  assert.equal(accountResponse.body.account.id, targetId);
  assert.equal(Object.hasOwn(accountResponse.body.account, "providerOperation"), false);
  assert.deepEqual(accountResponse.body.providerOperation, providerOperation);

  const userResponse = await request(app)
    .post("/users")
    .set("Authorization", authorization)
    .send({
      fullName: "Queued Account",
      email: "queued@example.com",
      employeeNumber: "QUEUED-1",
      roles: ["SUPPORT"],
    });
  assert.equal(userResponse.status, 202);
  assert.equal(userResponse.body.data.id, targetId);
  assert.equal(Object.hasOwn(userResponse.body.data, "providerOperation"), false);
  assert.deepEqual(userResponse.body.providerOperation, providerOperation);

  providerOperation.pending = false;
  providerOperation.status = "SUCCEEDED";
  delete providerOperation.reason;
  const completedAccountResponse = await request(app)
    .post(`/admin/accounts/${targetId}/reactivate`)
    .set("Authorization", authorization)
    .send({});
  assert.equal(completedAccountResponse.status, 200);
  const completedUserResponse = await request(app)
    .post("/users")
    .set("Authorization", authorization)
    .send({
      fullName: "Queued Account",
      email: "queued@example.com",
      employeeNumber: "QUEUED-1",
      roles: ["SUPPORT"],
    });
  assert.equal(completedUserResponse.status, 201);
});

test("provider operation resolve route requires a reason and preserves audited evidence", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });
  const actor = {
    ...account("APPROVED"),
    status: "ACTIVE",
    userRoles: [{ role: { roleName: "ADMINISTRATOR", rolePermissions: [] } }],
  };
  const operationId = crypto.randomUUID();
  const source = {
    id: operationId,
    userId: crypto.randomUUID(),
    operationType: "GLOBAL_SIGN_OUT",
    status: "ESCALATED",
    generation: 3,
    attemptCount: 5,
    nextAttemptAt: new Date(),
    claimedAt: null,
    claimToken: null,
    completedAt: new Date(),
    lastErrorCode: "PROVIDER_UNAVAILABLE",
    resolvedAt: null,
    resolutionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let updated = source;
  let audit;
  const originalOperationFind = prisma.accountProviderOperation.findUnique;
  const originalTransaction = prisma.$transaction;
  prisma.accountProviderOperation.findUnique = async () => ({ id: source.id, userId: source.userId });
  prisma.$transaction = async (work) => work({
    $executeRaw: async () => {},
    accountProviderOperation: {
      findUnique: async () => updated,
      updateMany: async ({ data }) => { updated = { ...updated, ...data }; return { count: 1 }; },
    },
    auditLog: { create: async ({ data }) => { audit = data; return data; } },
  });
  t.after(() => {
    prisma.accountProviderOperation.findUnique = originalOperationFind;
    prisma.$transaction = originalTransaction;
  });
  const { app, restore } = appFor(actor);
  t.after(restore);
  const authorization = `Bearer ${signAccessToken(actor)}`;

  const invalid = await request(app)
    .post(`/admin/maintenance/account-provider-operations/${operationId}/resolve`)
    .set("Authorization", authorization)
    .send({ reason: "short" });
  assert.equal(invalid.status, 422);

  const reason = "Provider state was verified manually";
  const resolved = await request(app)
    .post(`/admin/maintenance/account-provider-operations/${operationId}/resolve`)
    .set("Authorization", authorization)
    .send({ reason });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.operation.status, "RESOLVED");
  assert.equal(resolved.body.operation.resolutionReason, reason);
  assert.equal(resolved.body.operation.attemptCount, source.attemptCount);
  assert.equal(resolved.body.operation.lastErrorCode, source.lastErrorCode);
  assert.equal(audit.action, "ACCOUNT_PROVIDER_OPERATION_RESOLVED");
  assert.equal(audit.newValue.resolutionReason, reason);
});
