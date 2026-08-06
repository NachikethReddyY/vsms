const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const helpers = require("../helpers");

const ERRCODE_42501 = (error) =>
  /42501|permission denied|audit logs are immutable/i.test(String(error.message || ""));

const createAuditLogRow = async () => {
  const { id } = await helpers.prisma.auditLog.create({
    data: {
      action: "IMMUTABILITY_TEST",
      entityName: "IntegrationFixture",
      entityId: crypto.randomUUID(),
      outcome: "SUCCESS",
      requestId: crypto.randomUUID(),
      newValue: { note: "created by immutability integration test" },
    },
  });
  return id;
};

const createAuthAuditLogRow = async () => {
  const { id } = await helpers.prisma.authAuditLog.create({
    data: {
      eventType: "LOGIN_SUCCESS",
      outcome: "SUCCESS",
      requestId: crypto.randomUUID(),
      ipAddress: "127.0.0.1",
    },
  });
  return id;
};

after(async () => {
  await helpers.prisma.$disconnect();
});

test("audit_logs rejects UPDATE with a 42501 immutability error", async () => {
  const id = await createAuditLogRow();
  await assert.rejects(
    helpers.prisma.auditLog.update({
      where: { id },
      data: { outcome: "FAILED" },
    }),
    (error) => ERRCODE_42501(error),
  );
});

test("audit_logs rejects DELETE with a 42501 immutability error", async () => {
  const id = await createAuditLogRow();
  await assert.rejects(
    helpers.prisma.auditLog.delete({ where: { id } }),
    (error) => ERRCODE_42501(error),
  );
});

test("auth_audit_logs rejects UPDATE with a 42501 immutability error", async () => {
  const id = await createAuthAuditLogRow();
  await assert.rejects(
    helpers.prisma.authAuditLog.update({
      where: { id },
      data: { outcome: "DENIED" },
    }),
    (error) => ERRCODE_42501(error),
  );
});

test("auth_audit_logs rejects DELETE with a 42501 immutability error", async () => {
  const id = await createAuthAuditLogRow();
  await assert.rejects(
    helpers.prisma.authAuditLog.delete({ where: { id } }),
    (error) => ERRCODE_42501(error),
  );
});
