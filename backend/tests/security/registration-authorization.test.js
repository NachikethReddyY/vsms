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
} = require("../../utils/staff");
const { getEventIdForAccess } = require("../../services/qrService");

test("registration requires a non-admin role and a current event assignment", async () => {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let assignmentChecked = false;
  let assignmentWhere;
  const db = { staffAssignment: { findFirst: async ({ where }) => { assignmentChecked = true; assignmentWhere = where; return { id: crypto.randomUUID() }; } } };

  await assert.rejects(
    assertRegistrationAssignment(db, eventId, { userId, roles: ["ADMINISTRATOR", "REGISTRATION_OFFICER"] }),
    (error) => error.statusCode === 403,
  );
  assert.equal(assignmentChecked, false);

  await assert.doesNotReject(
    assertRegistrationAssignment(db, eventId, { userId, roles: ["REGISTRATION_OFFICER"] }),
  );
  assert.equal(assignmentWhere.eventId, eventId);
  assert.equal(assignmentWhere.shift.eventId, eventId);

  await assert.doesNotReject(
    assertRegistrationAssignment(db, null, { userId, roles: ["REGISTRATION_OFFICER"] }),
  );
});

test("screener assignment is station-scoped when a station id is supplied", async () => {
  const eventId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let assignmentWhere;
  const db = {
    staffAssignment: {
      findFirst: async ({ where }) => {
        assignmentWhere = where;
        return where.stationId === stationId ? { id: crypto.randomUUID() } : null;
      },
    },
  };

  await assert.doesNotReject(
    assertScreenerAssignment(db, eventId, { userId, roles: ["SCREENER"] }, stationId),
  );
  assert.equal(assignmentWhere.assignmentRole, "SCREENER");
  assert.equal(assignmentWhere.stationId, stationId);
  assert.equal(assignmentWhere.shift.status, "ACTIVE");
  assert.ok(assignmentWhere.shift.startsAt);
  assert.ok(assignmentWhere.shift.endsAt);

  await assert.rejects(
    assertScreenerAssignment(db, eventId, { userId, roles: ["SCREENER"] }, crypto.randomUUID()),
    (error) => error.statusCode === 403,
  );
});

test("QR verify accepts registration officers or screeners with active assignments", async () => {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const db = {
    staffAssignment: {
      findFirst: async ({ where }) => (
        where.assignmentRole === "SCREENER" || where.assignmentRole === "REGISTRATION"
          ? { id: crypto.randomUUID() }
          : null
      ),
    },
  };

  await assert.doesNotReject(
    assertQrVerifyAccess(db, eventId, { userId, roles: ["REGISTRATION_OFFICER"] }),
  );
  await assert.doesNotReject(
    assertQrVerifyAccess(db, eventId, { userId, roles: ["SCREENER"] }),
  );
  await assert.rejects(
    assertQrVerifyAccess(db, eventId, { userId, roles: ["REVIEWER"] }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    assertQrVerifyAccess(db, eventId, { userId, roles: ["ADMINISTRATOR", "SCREENER"] }),
    (error) => error.statusCode === 403,
  );
});

test("QR verify route allows SCREENER while generation stays registration-officer only", () => {
  const source = fs.readFileSync(path.join(__dirname, "../routes/qrRoutes.js"), "utf8");
  assert.match(source, /\/verify[\s\S]*REGISTRATION_OFFICER[\s\S]*SCREENER/);
  const officerOnlyGuard = 'router.use(requireAnyRole.operational("REGISTRATION_OFFICER"));';
  assert.ok(source.includes(officerOnlyGuard));
  assert.ok(source.indexOf('"/verify"') < source.indexOf(officerOnlyGuard));
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
