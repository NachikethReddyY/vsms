const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const userService = require("../../services/userService");
const { rolesFromCognitoGroups } = require("../../utils/roles");

const syncedAccess = (overrides = {}) => async () => ({
  managed: true,
  cognitoSub: null,
  compensate: async () => {},
  ...overrides,
});

const administrator = (id = crypto.randomUUID()) => ({
  id,
  fullName: "Administrator",
  email: "administrator@example.com",
  employeeNumber: "ADMIN-001",
  department: null,
  designation: null,
  status: "ACTIVE",
  sysRole: "ADMIN",
  createdAt: new Date(),
  userRoles: [{ role: { id: crypto.randomUUID(), roleName: "ADMINISTRATOR" } }],
});

function useTransaction(t, tx) {
  const original = prisma.$transaction;
  prisma.$transaction = async (callback) => callback(tx);
  t.after(() => { prisma.$transaction = original; });
}

test("legacy ADMIN Cognito group grants the canonical administrator application role", () => {
  assert.deepEqual(
    rolesFromCognitoGroups({ "cognito:groups": ["ADMIN", "Event Manager", "registration_officer", "unknown"] }),
    ["ADMINISTRATOR", "EVENT_MANAGER", "REGISTRATION_OFFICER"],
  );
});

test("staff management blocks self-demotion and self-deactivation", async (t) => {
  const current = administrator();
  useTransaction(t, {
    user: { findUnique: async () => current },
  });

  await assert.rejects(
    userService.updateUser(current.id, { roles: ["EVENT_MANAGER"] }, current.id, {}),
    (error) => error.code === "SELF_ADMIN_CHANGE_BLOCKED",
  );
  await assert.rejects(
    userService.updateUser(current.id, { status: "INACTIVE" }, current.id, {}),
    (error) => error.code === "SELF_ADMIN_CHANGE_BLOCKED",
  );
});

test("staff management keeps one active administrator", async (t) => {
  const current = administrator();
  useTransaction(t, {
    user: {
      findUnique: async () => current,
      count: async () => 1,
    },
  });

  await assert.rejects(
    userService.updateUser(current.id, { status: "INACTIVE" }, crypto.randomUUID(), {}),
    (error) => error.code === "LAST_ADMIN_CHANGE_BLOCKED",
  );
});

test("staff management records an audited role and status update", async (t) => {
  const current = administrator();
  const reviewerRoleId = crypto.randomUUID();
  const updated = {
    ...current,
    status: "INACTIVE",
    sysRole: "STAFF",
    userRoles: [{ role: { id: reviewerRoleId, roleName: "REVIEWER" } }],
  };
  const calls = [];
  useTransaction(t, {
    user: {
      findUnique: async () => current,
      count: async () => 2,
      update: async (input) => { calls.push(["user.update", input]); return updated; },
    },
    role: { findMany: async () => [{ id: reviewerRoleId, roleName: "REVIEWER" }] },
    userRole: {
      deleteMany: async (input) => { calls.push(["userRole.deleteMany", input]); },
      createMany: async (input) => { calls.push(["userRole.createMany", input]); },
    },
    auditLog: { create: async (input) => { calls.push(["auditLog.create", input]); } },
  });

  const result = await userService.updateUser(current.id, {
    roles: ["REVIEWER"],
    status: "INACTIVE",
  }, crypto.randomUUID(), { requestId: crypto.randomUUID() }, syncedAccess());

  assert.deepEqual(result.roles, ["REVIEWER"]);
  assert.equal(result.status, "INACTIVE");
  assert.equal(calls.find(([name]) => name === "auditLog.create")[1].data.action, "STAFF_ACCOUNT_UPDATED");
});

test("staff creation synchronizes Cognito before committing the local account", async (t) => {
  const actorId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const cognitoSub = crypto.randomUUID();
  const calls = [];
  const created = {
    id: crypto.randomUUID(),
    cognitoSub,
    fullName: "Support Person",
    email: "support@example.com",
    employeeNumber: "SUP-001",
    department: null,
    designation: null,
    status: "ACTIVE",
    sysRole: "STAFF",
    createdAt: new Date(),
    userRoles: [{ role: { id: roleId, roleName: "SUPPORT" } }],
  };
  useTransaction(t, {
    user: {
      findUnique: async () => null,
      create: async (input) => { calls.push(["user.create", input]); return created; },
    },
    role: { findMany: async () => [{ id: roleId, roleName: "SUPPORT" }] },
    auditLog: { create: async (input) => { calls.push(["auditLog.create", input]); } },
  });
  const provider = async (input) => {
    calls.push(["cognito.sync", input]);
    return { managed: true, cognitoSub, compensate: async () => { calls.push(["cognito.compensate"]); } };
  };

  const result = await userService.createUser({
    fullName: created.fullName,
    email: created.email,
    employeeNumber: created.employeeNumber,
    department: null,
    designation: null,
    status: "ACTIVE",
    roles: ["SUPPORT"],
  }, actorId, {}, provider);

  assert.deepEqual(calls[0], ["cognito.sync", { email: created.email, roles: ["SUPPORT"], status: "ACTIVE" }]);
  assert.equal(calls.find(([name]) => name === "user.create")[1].data.cognitoSub, cognitoSub);
  assert.equal(calls.some(([name]) => name === "cognito.compensate"), false);
  assert.deepEqual(result.roles, ["SUPPORT"]);
  assert.equal(result.cognitoSub, undefined);
});

test("staff role updates do not mutate local roles when Cognito synchronization fails", async (t) => {
  const current = administrator();
  const calls = [];
  useTransaction(t, {
    user: {
      findUnique: async () => current,
      count: async () => 2,
      update: async () => { calls.push(["user.update"]); return current; },
    },
    role: { findMany: async () => [{ id: crypto.randomUUID(), roleName: "REVIEWER" }] },
    userRole: {
      deleteMany: async () => { calls.push(["userRole.deleteMany"]); },
      createMany: async () => { calls.push(["userRole.createMany"]); },
    },
  });

  await assert.rejects(
    userService.updateUser(current.id, { roles: ["REVIEWER"] }, crypto.randomUUID(), {}, async () => {
      throw new Error("Cognito unavailable");
    }),
    /Cognito unavailable/,
  );
  assert.deepEqual(calls, []);
});

test("staff role updates compensate Cognito when the local transaction fails", async (t) => {
  const current = administrator();
  let compensated = 0;
  useTransaction(t, {
    user: {
      findUnique: async () => current,
      count: async () => 2,
      update: async () => { throw new Error("Database write failed"); },
    },
    role: { findMany: async () => [{ id: crypto.randomUUID(), roleName: "REVIEWER" }] },
    userRole: {
      deleteMany: async () => ({}),
      createMany: async () => ({}),
    },
  });

  await assert.rejects(
    userService.updateUser(current.id, { roles: ["REVIEWER"] }, crypto.randomUUID(), {}, syncedAccess({
      compensate: async () => { compensated += 1; },
    })),
    /Database write failed/,
  );
  assert.equal(compensated, 1);
});
