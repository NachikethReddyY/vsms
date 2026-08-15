const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const qrService = require("../../services/participant/qrService");
const registrationService = require("../../services/participant/registrationService");

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

test("cancelling a registration delegates QR revocation to the atomic database routine", async () => {
  let routineStatement;
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
      findUnique: async ({ include }) => include ? updated : existing,
    },
    $queryRaw: async (query) => {
      routineStatement = (Array.isArray(query) ? query : query.strings).join(" ");
      return [{ promoted_registration_id: null, revoked_qr_count: 1n }];
    },
    auditLog: { create: async ({ data }) => { audit = data; return data; } },
  };
  const db = { ...tx, $transaction: async (work) => work(tx) };

  const result = await registrationService.changeRegistrationStatus({
    registrationId,
    toStatus: "CANCELLED",
    reason: "Participant withdrew",
    auth,
    context: { requestId: "55555555-5555-4555-8555-555555555555" },
  }, db);

  assert.equal(result.registrationStatus, "CANCELLED");
  assert.match(routineStatement, /cancel_event_registration/);
  assert.equal(audit.newValue.revokedQrPassCount, 1);
});
