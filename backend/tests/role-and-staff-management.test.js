const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../prisma/prismaClient");
const userService = require("../services/userService");
const { rolesFromCognitoGroups } = require("../utils/roles");

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
  }, crypto.randomUUID(), { requestId: crypto.randomUUID() });

  assert.deepEqual(result.roles, ["REVIEWER"]);
  assert.equal(result.status, "INACTIVE");
  assert.equal(calls.find(([name]) => name === "auditLog.create")[1].data.action, "STAFF_ACCOUNT_UPDATED");
});
