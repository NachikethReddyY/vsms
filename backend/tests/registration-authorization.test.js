const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { assertRegistrationAssignment } = require("../utils/staff");
const { getEventIdForAccess } = require("../services/qrService");

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
