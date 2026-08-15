const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.NODE_ENV = "test";

const prisma = require("../../prisma/prismaClient");
const accountService = require("../../services/account/accountService");

test("a later explicit reactivation can restore a fully deprovisioned account", async () => {
  const actor = await prisma.user.create({
    data: {
      fullName: "Account Restore Actor",
      email: `${crypto.randomUUID()}@test.local`,
      approvalState: "APPROVED",
    },
  });
  const account = await prisma.user.create({
    data: {
      fullName: "Account Restore Subject",
      email: `${crypto.randomUUID()}@test.local`,
      approvalState: "APPROVED",
      accessState: "SUSPENDED",
      status: "SUSPENDED",
    },
  });

  await accountService.deprovision(account.id, "Restore lifecycle verification", actor.id, {}, {
    providerOverrides: { disableAndRevoke: async () => ({ managed: true }) },
  });

  const restored = await accountService.changeAccess(account.id, "reactivate", "Restore lifecycle verification", actor.id, {}, {
    providerOverrides: {
      synchronize: async () => ({ managed: false, cognitoSub: null, compensate: async () => {} }),
    },
  });

  assert.equal(restored.accessState, "ENABLED");
  assert.equal(restored.status, "ACTIVE");
  assert.equal(restored.deprovisionedAt, null);
});
