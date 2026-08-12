const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const {
  assertRegistrationAssignment,
  assertScreenerAssignment,
  assertQrVerifyAccess,
} = require("../../utils/auth/staff");
const {
  getEventIdForAccess,
  assertRegistrationAccess,
  assertVerificationAccess,
} = require("../../services/participant/qrService");
const { authorizeSignatureTarget } = require("../../services/participant/signatureService");

const account = (userId, roles = []) => ({
  userId,
  roles,
  user: { id: userId, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" },
});

const authorizationDb = (eventId, userId, role, assignment) => ({
  event: { findUnique: async () => ({ eventId, status: "IN_PROGRESS" }) },
  eventMembership: { findFirst: async ({ where }) => where.userId === userId ? { id: crypto.randomUUID(), status: "ACTIVE", roles: [{ role }] } : null },
  staffAssignment: { findFirst: assignment },
});

test("registration requires event membership and a current duty; platform admin has no bypass", async () => {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let assignmentChecked = false;
  let assignmentWhere;
  const db = authorizationDb(eventId, userId, "REGISTRATION", async ({ where }) => { assignmentChecked = true; assignmentWhere = where; return { id: crypto.randomUUID() }; });

  await assert.rejects(
    assertRegistrationAssignment(authorizationDb(eventId, crypto.randomUUID(), "REGISTRATION", async () => ({ id: crypto.randomUUID() })), eventId, account(userId, ["ADMINISTRATOR"])),
    (error) => error.status === 403 && error.code === "EVENT_ROLE_REQUIRED",
  );
  assert.equal(assignmentChecked, false);

  await assert.doesNotReject(
    assertRegistrationAssignment(db, eventId, account(userId)),
  );
  assert.equal(assignmentWhere.eventId, eventId);
  assert.equal(assignmentWhere.shift.eventId, eventId);
});

test("screener assignment is station-scoped when a station id is supplied", async () => {
  const eventId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let assignmentWhere;
  const db = {
    event: { findUnique: async () => ({ eventId, status: "IN_PROGRESS" }) },
    eventMembership: { findFirst: async () => ({ id: crypto.randomUUID(), status: "ACTIVE", roles: [{ role: "SCREENER" }] }) },
    staffAssignment: {
      findFirst: async ({ where }) => {
        assignmentWhere = where;
        return where.stationId === stationId ? { id: crypto.randomUUID() } : null;
      },
    },
  };

  await assert.doesNotReject(
    assertScreenerAssignment(db, eventId, account(userId), stationId),
  );
  assert.equal(assignmentWhere.assignmentRole, "SCREENER");
  assert.equal(assignmentWhere.stationId, stationId);
  assert.equal(assignmentWhere.shift.status, "ACTIVE");
  assert.ok(assignmentWhere.shift.startsAt);
  assert.ok(assignmentWhere.shift.endsAt);

  await assert.rejects(
    assertScreenerAssignment(db, eventId, account(userId), crypto.randomUUID()),
    (error) => error.status === 403,
  );
});

test("QR verify accepts registration officers or screeners with active assignments", async () => {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const db = {
    event: { findUnique: async () => ({ eventId, status: "IN_PROGRESS" }) },
    eventMembership: { findFirst: async ({ where }) => ({ id: crypto.randomUUID(), status: "ACTIVE", roles: [{ role: where.userId.endsWith("0") ? "REGISTRATION" : "SCREENER" }] }) },
    staffAssignment: {
      findFirst: async ({ where }) => (
        where.assignmentRole === "SCREENER" || where.assignmentRole === "REGISTRATION"
          ? { id: crypto.randomUUID() }
          : null
      ),
    },
  };

  await assert.doesNotReject(
    assertQrVerifyAccess(db, eventId, account(`${userId.slice(0, -1)}0`)),
  );
  await assert.doesNotReject(
    assertQrVerifyAccess(db, eventId, account(userId)),
  );
  await assert.rejects(
    assertQrVerifyAccess({ ...db, eventMembership: { findFirst: async () => null } }, eventId, account(userId)),
    (error) => error.status === 403,
  );
  await assert.rejects(
    assertQrVerifyAccess({ ...db, eventMembership: { findFirst: async () => null } }, eventId, account(userId, ["ADMINISTRATOR"])),
    (error) => error.status === 403,
  );
});

test("QR routes delegate event membership and duty authorization to controllers", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../routes/qrRoutes.js"), "utf8");
  assert.match(source, /"\/verify"[\s\S]*qrController\.verifyQR/);
  assert.doesNotMatch(source, /requireAnyRole|REGISTRATION_OFFICER/);
});

test("QR access resolves the registration event and rejects event confusion", async () => {
  const eventId = crypto.randomUUID();
  const otherEventId = crypto.randomUUID();
  const db = {
    eventRegistration: { findUnique: async () => ({ eventId }) },
    qRCodePass: { findFirst: async () => ({ registration: { eventId } }) },
  };

  assert.equal(await getEventIdForAccess({ registrationId: crypto.randomUUID() }, db), eventId);
  assert.equal(await getEventIdForAccess({ token: "test-token" }, db), eventId);
  await assert.rejects(
    getEventIdForAccess({ token: "test-token", eventId: otherEventId }, db),
    (error) => error.status === 400 && error.code === "QR_EVENT_MISMATCH",
  );
});

test("QR service keeps registration and verification authorization event-scoped", async () => {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const db = {
    eventRegistration: { findUnique: async () => ({ eventId }) },
    qRCodePass: { findFirst: async () => ({ registration: { eventId } }) },
    event: { findUnique: async () => ({ eventId, status: "IN_PROGRESS" }) },
    eventMembership: { findFirst: async () => ({ id: crypto.randomUUID(), status: "ACTIVE", roles: [{ role: "REGISTRATION" }] }) },
    staffAssignment: { findFirst: async () => ({ id: crypto.randomUUID() }) },
  };

  await assert.doesNotReject(assertRegistrationAccess({ registrationId: crypto.randomUUID() }, account(userId), db));
  await assert.doesNotReject(assertVerificationAccess({ token: "a".repeat(64) }, account(userId), db));
});

test("signature target authorization keeps registration duty and participant event scope", async () => {
  const eventId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const db = {
    event: { findUnique: async () => ({ eventId, status: "IN_PROGRESS" }) },
    eventMembership: { findFirst: async () => ({ id: crypto.randomUUID(), status: "ACTIVE", roles: [{ role: "REGISTRATION" }] }) },
    staffAssignment: { findFirst: async () => ({ id: crypto.randomUUID() }) },
    participant: { findFirst: async () => ({ id: participantId }) },
  };

  await assert.doesNotReject(authorizeSignatureTarget({
    eventId,
    targetId: participantId,
    purpose: "CONSENT",
    auth: account(userId),
  }, db));
});
