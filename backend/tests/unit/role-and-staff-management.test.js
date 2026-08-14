const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const userService = require("../../services/account/userService");
const { rolesFromCognitoGroups } = require("../../utils/auth/roles");
const { createUserBody, updateUserBody } = require("../../schemas/userSchemas");

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
    ["ADMINISTRATOR", "EVENT_MANAGER"],
  );
});

test("staff management blocks self-demotion and rejects lifecycle fields", async (t) => {
  const current = administrator();
  useTransaction(t, {
    $executeRaw: async () => {},
    user: { findUnique: async () => current },
  });

  await assert.rejects(
    userService.updateUser(current.id, { roles: ["EVENT_MANAGER"] }, current.id, {}),
    (error) => error.code === "SELF_ADMIN_CHANGE_BLOCKED",
  );
  assert.equal(updateUserBody.safeParse({ status: "INACTIVE" }).success, false);
});

test("generic staff creation accepts a missing employee number and global role", () => {
  assert.equal(createUserBody.safeParse({
    fullName: "Staff Person",
    email: "staff@example.com",
    roles: [],
  }).success, true);
});

test("staff management keeps one active administrator", async (t) => {
  const current = administrator();
  const calls = [];
  useTransaction(t, {
    $executeRaw: async () => { calls.push("lock"); },
    user: {
      findUnique: async () => current,
      count: async () => { calls.push("count"); return 1; },
    },
    role: { findMany: async () => [{ id: crypto.randomUUID(), roleName: "REVIEWER" }] },
  });

  await assert.rejects(
    userService.updateUser(current.id, { roles: ["REVIEWER"] }, crypto.randomUUID(), {}, syncedAccess()),
    (error) => error.code === "LAST_ADMIN_CHANGE_BLOCKED",
  );
  assert.deepEqual(calls, ["lock", "lock", "count"]);
});

test("staff management locks, commits, and only then synchronizes Cognito roles", async (t) => {
  const current = administrator();
  const reviewerRoleId = crypto.randomUUID();
  const updated = {
    ...current,
    status: "ACTIVE",
    sysRole: "STAFF",
    userRoles: [{ role: { id: reviewerRoleId, roleName: "REVIEWER" } }],
  };
  const calls = [];
  useTransaction(t, {
    $executeRaw: async () => { calls.push(["admin.lock"]); },
    user: {
      findUnique: async () => current,
      count: async () => 2,
      update: async (input) => {
        calls.push(["user.update", input]);
        return input.select?.providerStateGeneration ? { providerStateGeneration: 1 } : updated;
      },
    },
    role: { findMany: async () => [{ id: reviewerRoleId, roleName: "REVIEWER" }] },
    userRole: {
      deleteMany: async (input) => { calls.push(["userRole.deleteMany", input]); },
      createMany: async (input) => { calls.push(["userRole.createMany", input]); },
    },
    auditLog: { create: async (input) => { calls.push(["auditLog.create", input]); } },
    accountProviderOperation: {
      updateMany: async () => {},
      findUnique: async () => null,
      create: async () => ({ id: "provider-operation", generation: 1 }),
    },
  });

  const provider = async () => {
    calls.push(["cognito.sync"]);
    return { managed: true, cognitoSub: null, compensate: async () => {} };
  };
  const result = await userService.updateUser(current.id, {
    roles: ["REVIEWER"],
  }, crypto.randomUUID(), { requestId: crypto.randomUUID() }, provider, async (_id, options) => {
    assert.equal(options.synchronize, provider);
    calls.push(["cognito.sync"]);
  });

  assert.deepEqual(result.roles, ["REVIEWER"]);
  assert.equal(result.status, "ACTIVE");
  assert.ok(calls.findIndex(([name]) => name === "user.update") < calls.findIndex(([name]) => name === "cognito.sync"));
  assert.equal(calls.find(([name]) => name === "auditLog.create")[1].data.action, "STAFF_ACCOUNT_UPDATED");
});

test("staff creation commits an outbox operation before synchronizing Cognito", async (t) => {
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
    $executeRaw: async () => ({}),
    user: {
      findUnique: async () => null,
      create: async (input) => { calls.push(["user.create", input]); return created; },
      update: async () => ({ providerStateGeneration: 1 }),
    },
    role: { findMany: async () => [{ id: roleId, roleName: "SUPPORT" }] },
    auditLog: { create: async (input) => { calls.push(["auditLog.create", input]); } },
    accountProviderOperation: {
      findUnique: async () => null,
      create: async (input) => { calls.push(["providerOperation.create", input]); return { id: "provider-operation", generation: 1 }; },
    },
  });
  const provider = async (input) => {
    calls.push(["cognito.sync", input]);
    return { managed: true, cognitoSub, compensate: async () => { calls.push(["cognito.compensate"]); } };
  };

  const result = await userService.createUser({
    fullName: created.fullName,
    email: created.email,
    department: null,
    designation: null,
    status: "ACTIVE",
    roles: ["SUPPORT"],
  }, actorId, {}, provider, async (_id, options) => {
    assert.equal(options.synchronize, provider);
    calls.push(["cognito.sync"]);
  });

  assert.ok(calls.findIndex(([name]) => name === "providerOperation.create") < calls.findIndex(([name]) => name === "cognito.sync"));
  const createData = calls.find(([name]) => name === "user.create")[1].data;
  assert.equal(createData.cognitoSub, undefined);
  assert.match(createData.employeeNumber, /^STF-[A-F0-9]{16}$/);
  assert.equal(calls.some(([name]) => name === "cognito.compensate"), false);
  assert.deepEqual(result.roles, ["SUPPORT"]);
  assert.equal(result.cognitoSub, undefined);
});

test("staff role updates remain committed when post-commit provider processing fails", async (t) => {
  const current = administrator();
  const calls = [];
  useTransaction(t, {
    $executeRaw: async () => ({}),
    user: {
      findUnique: async () => current,
      count: async () => 2,
      update: async (input) => {
        calls.push(["user.update"]);
        return input.select?.providerStateGeneration ? { providerStateGeneration: 1 } : current;
      },
    },
    role: { findMany: async () => [{ id: crypto.randomUUID(), roleName: "REVIEWER" }] },
    userRole: {
      deleteMany: async () => { calls.push(["userRole.deleteMany"]); },
      createMany: async () => { calls.push(["userRole.createMany"]); },
    },
    auditLog: { create: async () => { calls.push(["auditLog.create"]); } },
    accountProviderOperation: {
      updateMany: async () => {},
      findUnique: async () => null,
      create: async () => ({ id: "provider-operation", generation: 1 }),
    },
  });

  await assert.rejects(
    userService.updateUser(current.id, { roles: ["REVIEWER"] }, crypto.randomUUID(), {}, syncedAccess(), async () => {
      throw new Error("Cognito unavailable");
    }),
    /Cognito unavailable/,
  );
  assert.ok(calls.some(([name]) => name === "user.update"));
  assert.ok(calls.some(([name]) => name === "auditLog.create"));
});

test("staff role updates never call Cognito when the database transaction fails", async (t) => {
  const current = administrator();
  let providerCalls = 0;
  useTransaction(t, {
    $executeRaw: async () => ({}),
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
    userService.updateUser(current.id, { roles: ["REVIEWER"] }, crypto.randomUUID(), {}, syncedAccess(), async () => {
      providerCalls += 1;
    }),
    /Database write failed/,
  );
  assert.equal(providerCalls, 0);
});

test("authoritative unique-field conflicts return an account conflict", async (t) => {
  const current = administrator();
  useTransaction(t, {
    $executeRaw: async () => {},
    user: {
      findUnique: async () => current,
      update: async () => { throw Object.assign(new Error("duplicate"), { code: "P2002" }); },
    },
  });

  await assert.rejects(
    userService.updateUser(current.id, { employeeNumber: "DUPLICATE" }, current.id, {}),
    (error) => error.status === 409 && error.code === "ACCOUNT_FIELD_CONFLICT",
  );
});
