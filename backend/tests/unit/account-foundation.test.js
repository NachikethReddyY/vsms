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
const { syncLocalUser } = require("../../utils/staff");
const accountService = require("../../services/account/accountService");
const requireApprovedAccount = require("../../middlewares/requireApprovedAccount");
const { sessionValidity } = require("../../utils/sessionValidity");
const { profileUpdateBody, accountListQuery, approvalBody } = require("../../schemas/accountSchemas");

function patch(t, target, property, value) {
  const original = target[property];
  target[property] = value;
  t.after(() => { target[property] = original; });
}

test("verified signup creates a pending local account without a role or employee number", async (t) => {
  const id = crypto.randomUUID();
  let createInput;
  patch(t, prisma.user, "findFirst", async () => null);
  patch(t, prisma.user, "create", async ({ data }) => {
    createInput = data;
    return { id, ...data };
  });
  patch(t, prisma.user, "findUnique", async () => ({
    id,
    email: "new@example.com",
    employeeNumber: null,
    approvalState: "PENDING",
    accessState: "ENABLED",
    status: "INACTIVE",
    userRoles: [],
  }));

  const account = await syncLocalUser({
    cognitoSub: crypto.randomUUID(),
    email: "new@example.com",
    fullName: "New Person",
  }, { allowCreate: true });

  assert.equal(createInput.employeeNumber, null);
  assert.equal(createInput.approvalState, "PENDING");
  assert.equal(createInput.accessState, "ENABLED");
  assert.equal(createInput.userRoles, undefined);
  assert.deepEqual(account.userRoles, []);
});

test("pending roleless sessions can read account state but fail the operational gate", async (t) => {
  const user = {
    id: crypto.randomUUID(),
    email: "pending@example.com",
    status: "INACTIVE",
    approvalState: "PENDING",
    accessState: "ENABLED",
    deprovisionedAt: null,
    sessionInvalidBefore: null,
    userRoles: [],
  };
  patch(t, prisma.user, "findUnique", async () => user);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });

  const requireAuthentication = require("../../middlewares/requireAuthentication");
  const app = express();
  app.use(cookieParser());
  app.get("/account", requireAuthentication, (_req, res) => res.json({ ok: true }));
  app.get("/operational", requireAuthentication, requireApprovedAccount, (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
  const authorization = `Bearer ${signAccessToken(user)}`;

  assert.equal((await request(app).get("/account").set("Authorization", authorization)).status, 200);
  const denied = await request(app).get("/operational").set("Authorization", authorization);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "ACCOUNT_NOT_OPERATIONAL");
});

test("session invalid-before rejects an older otherwise valid token", async (t) => {
  const user = {
    id: crypto.randomUUID(),
    email: "revoked@example.com",
    status: "ACTIVE",
    approvalState: "APPROVED",
    accessState: "ENABLED",
    deprovisionedAt: null,
    sessionInvalidBefore: new Date("2100-01-01T00:00:00.000Z"),
    userRoles: [],
  };
  patch(t, prisma.user, "findUnique", async () => user);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  t.after(() => { global.fetch = originalFetch; });

  const app = express();
  app.use(cookieParser());
  app.get("/account", require("../../middlewares/requireAuthentication"), (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
  const response = await request(app).get("/account").set("Authorization", `Bearer ${signAccessToken(user)}`);
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "SESSION_REVOKED");
});

test("rejection writes an immutable decision record and account audit in one transaction", async (t) => {
  const actorId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const calls = [];
  const account = {
    id: accountId,
    fullName: "Pending Person",
    email: "pending@example.com",
    status: "INACTIVE",
    approvalState: "PENDING",
    accessState: "ENABLED",
    deprovisionedAt: null,
    userRoles: [],
    eventMemberships: [],
  };
  const tx = {
    $executeRaw: async () => {},
    user: {
      findUnique: async () => account,
      update: async ({ data }) => ({ ...account, ...data }),
    },
    accountApprovalDecision: {
      create: async ({ data }) => { calls.push(["decision", data]); },
    },
    auditLog: {
      create: async ({ data }) => { calls.push(["audit", data]); },
    },
  };
  patch(t, prisma, "$transaction", async (callback) => callback(tx));

  const result = await accountService.decideApproval(
    accountId, "REJECTED", "Identity could not be verified", actorId, {}, async () => ({ queued: false }),
  );

  assert.equal(result.approvalState, "REJECTED");
  assert.deepEqual(calls[0], ["decision", {
    userId: accountId,
    decision: "REJECTED",
    decidedById: actorId,
    reason: "Identity could not be verified",
  }]);
  assert.equal(calls[1][0], "audit");
  assert.equal(calls[1][1].action, "ACCOUNT_REJECTED");
});

test("approval assigns roles and queues Cognito synchronization in the same transaction", async (t) => {
  const actorId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const calls = [];
  let assigned = [];
  const account = {
    id: accountId,
    fullName: "Pending Person",
    email: "pending@example.com",
    status: "INACTIVE",
    approvalState: "PENDING",
    accessState: "ENABLED",
    deprovisionedAt: null,
    userRoles: [],
    eventMemberships: [],
  };
  const tx = {
    $executeRaw: async () => {},
    role: { findMany: async () => [{ id: roleId, roleName: "REVIEWER" }] },
    userRole: {
      deleteMany: async () => { assigned = []; },
      createMany: async ({ data }) => { assigned = data; calls.push(["roles", data]); },
    },
    user: {
      findUnique: async () => account,
      update: async ({ data }) => data.providerStateGeneration
        ? { providerStateGeneration: 1 }
        : { ...account, ...data, userRoles: assigned.map(() => ({ role: { roleName: "REVIEWER" } })), updatedAt: new Date() },
    },
    accountApprovalDecision: {
      create: async ({ data }) => ({ id: crypto.randomUUID(), ...data }),
    },
    accountProviderOperation: {
      findUnique: async () => null,
      create: async ({ data }) => ({ id: operationId, generation: 1, status: "PENDING", ...data }),
    },
    auditLog: { create: async ({ data }) => { calls.push(["audit", data]); } },
  };
  patch(t, prisma, "$transaction", async (callback) => callback(tx));

  const result = await accountService.decideApproval(
    accountId,
    "APPROVED",
    null,
    actorId,
    {},
    async () => ({ queued: false }),
    {
      roles: ["REVIEWER"],
      processProviderOperation: async () => ({
        operation: { id: operationId, operationType: "SYNC_ACCESS", generation: 1, status: "SUCCEEDED" },
        pending: false,
      }),
    },
  );

  assert.equal(result.approvalState, "APPROVED");
  assert.deepEqual(result.roles, ["REVIEWER"]);
  assert.equal(result.providerOperation.status, "SUCCEEDED");
  assert.equal(calls[0][0], "roles");
  assert.deepEqual(calls.find(([name]) => name === "audit")[1].newValue.roles, ["REVIEWER"]);
});

test("Cognito revocation uses auth_time even when refreshed-token iat is newer than the cutoff", () => {
  const cutoff = new Date("2026-08-06T10:00:00.000Z");
  const payload = {
    auth_time: Math.floor(new Date("2026-08-06T09:00:00.000Z").getTime() / 1000),
    iat: Math.floor(new Date("2026-08-06T11:00:00.000Z").getTime() / 1000),
  };
  assert.deepEqual(sessionValidity({ sessionInvalidBefore: cutoff }, payload), {
    valid: false,
    reason: "SESSION_REVOKED",
  });
  assert.equal(sessionValidity({ sessionInvalidBefore: null }, { iat: payload.iat }).reason, "MISSING_SESSION_ORIGIN");
  assert.equal(sessionValidity({ sessionInvalidBefore: null }, { iat: payload.iat }, { allowLocalIatFallback: true }).valid, true);
});

test("pending, rejected, and suspended accounts stay outside the operational gate", () => {
  const base = { status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED", deprovisionedAt: null };
  assert.equal(requireApprovedAccount.isApprovedAccount(base), true);
  assert.equal(requireApprovedAccount.isApprovedAccount({ ...base, status: "INACTIVE", approvalState: "PENDING" }), false);
  assert.equal(requireApprovedAccount.isApprovedAccount({ ...base, status: "INACTIVE", approvalState: "REJECTED" }), false);
  assert.equal(requireApprovedAccount.isApprovedAccount({ ...base, status: "SUSPENDED", accessState: "SUSPENDED" }), false);
});

test("self-service profile rejects employment fields and account filters are strict", () => {
  for (const field of ["employeeNumber", "department", "designation", "approvalState", "accessState"]) {
    assert.equal(profileUpdateBody.safeParse({ [field]: "changed" }).success, false);
  }
  assert.equal(profileUpdateBody.safeParse({ fullName: "Safe Name" }).success, true);
  assert.equal(profileUpdateBody.safeParse({ professionalCategory: "DOCTOR" }).success, false);
  assert.equal(accountListQuery.safeParse({ page: "0" }).success, false);
  assert.equal(accountListQuery.safeParse({ limit: "101" }).success, false);
  assert.equal(accountListQuery.safeParse({ approvalState: "UNKNOWN" }).success, false);
  assert.equal(accountListQuery.safeParse({ unexpected: "value" }).success, false);
  assert.equal(approvalBody.safeParse({}).success, false);
  assert.equal(approvalBody.safeParse({ roles: ["REVIEWER"] }).success, true);
});

test("new lifecycle API locks the account before protecting the final administrator", async (t) => {
  const actorId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const locks = [];
  const account = {
    id: accountId,
    fullName: "Final Administrator",
    email: "final-admin@example.com",
    status: "ACTIVE",
    approvalState: "APPROVED",
    accessState: "ENABLED",
    deprovisionedAt: null,
    userRoles: [{ role: { roleName: "ADMINISTRATOR" } }],
    eventMemberships: [],
  };
  const tx = {
    $executeRaw: async () => { locks.push("lock"); },
    user: {
      findUnique: async () => account,
      count: async () => 1,
    },
  };
  patch(t, prisma, "$transaction", async (callback) => callback(tx));

  await assert.rejects(
    accountService.decideApproval(accountId, "REJECTED", "Administrative change", actorId, {}),
    (error) => error.code === "LAST_ADMIN_CHANGE_BLOCKED",
  );
  assert.deepEqual(locks, ["lock", "lock"]);
});
