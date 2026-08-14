const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const qrService = require("../../backend/services/participant/qrService");
const registrationService = require("../../backend/services/participant/registrationService");

const eventId = "11111111-1111-4111-8111-111111111111";
const registrationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const auth = {
  userId,
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
  roles: ["REGISTRATION"],
};

test("QR issuance is closed when the registration or event is cancelled", async () => {
  for (const registration of [
    { registrationStatus: "CANCELLED", event: { status: "IN_PROGRESS" } },
    { registrationStatus: "SIGNED_UP", event: { status: "CANCELLED" } },
  ]) {
    let passLookup = false;
    const tx = {
      eventRegistration: {
        findUnique: async () => ({ registrationId, eventId, participant: {}, ...registration }),
      },
      qRCodePass: {
        findFirst: async () => { passLookup = true; return null; },
      },
    };

    await assert.rejects(
      qrService.generateQR(registrationId, userId, tx),
      (error) => error.status === 409 && error.code === "QR_LIFECYCLE_CLOSED",
    );
    assert.equal(passLookup, false);
  }
});

test("cancelling a registration revokes its active passes in the same transaction", async () => {
  let audit;
  const existing = { registrationId, eventId, registrationStatus: "SIGNED_UP" };
  const updated = { ...existing, registrationStatus: "CANCELLED", event: {}, participant: {}, statusHistory: [] };
  const tx = {
    event: {
      findUnique: async () => ({ eventId, status: "IN_PROGRESS" }),
    },
    eventMembership: {
      findFirst: async () => ({
        user: { professionalCategory: null },
        roles: [{ role: "REGISTRATION" }],
      }),
    },
    staffAssignment: {
      findFirst: async () => ({ id: "44444444-4444-4444-8444-444444444444", assignmentRole: "REGISTRATION" }),
    },
    eventRegistration: {
      findUnique: async () => updated,
    },
    registrationStatusHistory: { create: async () => ({}) },
    auditLog: { create: async ({ data }) => { audit = data; return data; } },
    $queryRaw: async () => [{ promoted_registration_id: null, revoked_qr_count: 1n }],
  };
  const db = {
    event: tx.event,
    eventMembership: tx.eventMembership,
    eventRegistration: { findUnique: async () => existing },
    staffAssignment: tx.staffAssignment,
    $transaction: async (work) => work(tx),
  };

  const result = await registrationService.changeRegistrationStatus({
    registrationId,
    toStatus: "CANCELLED",
    reason: "Participant withdrew",
    auth,
    context: { requestId: "55555555-5555-4555-8555-555555555555" },
  }, db);

  assert.equal(result.registrationStatus, "CANCELLED");
  assert.equal(audit.newValue.revokedQrPassCount, 1);
});

test("the cancellation routine owns QR revocation and reports its row count", () => {
  const migration = require("node:fs").readFileSync(
    require("node:path").join(
      __dirname,
      "../../backend/prisma/migrations/20260814210000_harden_registration_stored_routines/migration.sql",
    ),
    "utf8",
  );

  assert.match(migration, /UPDATE public\.qr_code_passes AS pass/);
  assert.match(migration, /GET DIAGNOSTICS v_revoked_qr_count = ROW_COUNT/);
  assert.match(migration, /RETURN QUERY SELECT[\s\S]*v_revoked_qr_count/);
});
