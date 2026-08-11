const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const authorization = require("../../services/event/eventAuthorizationService");

const eventA = crypto.randomUUID();
const eventB = crypto.randomUUID();
const userId = crypto.randomUUID();
const approvedUser = {
  userId,
  id: userId,
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
  roles: [],
};

function dbWith({ memberships = [], duty = null, eventStatus = "IN_PROGRESS" } = {}) {
  return {
    event: {
      findUnique: async ({ where }) => where.eventId === eventA || where.eventId === eventB
        ? { eventId: where.eventId, name: "Scoped event", status: eventStatus, version: 1 }
        : null,
    },
    eventMembership: {
      findFirst: async ({ where }) => {
        const membership = memberships.find((item) => item.eventId === where.eventId && item.userId === where.userId && item.status === "ACTIVE");
        return membership || null;
      },
    },
    staffAssignment: { findFirst: async () => duty },
  };
}

const membership = (eventId, roles, professionalCategory = "STAFF") => ({
  id: crypto.randomUUID(),
  eventId,
  userId,
  status: "ACTIVE",
  roles: roles.map((role) => ({ id: crypto.randomUUID(), role, assignedAt: new Date() })),
  user: { ...approvedUser, professionalCategory },
});

test("event roles are scoped independently across two events", async () => {
  const db = dbWith({ memberships: [membership(eventA, ["SCREENER"]), membership(eventB, ["REVIEWER"])] });
  await authorization.requireEventRoles(eventA, approvedUser, ["SCREENER"], { db });
  await authorization.requireEventRoles(eventB, approvedUser, ["REVIEWER"], { db });
  await assert.rejects(
    authorization.requireEventRoles(eventA, approvedUser, ["REVIEWER"], { db }),
    (error) => error.code === "EVENT_ROLE_REQUIRED",
  );
});

test("platform administrator can manage events but cannot operate clinical queues without membership", async () => {
  const administrator = { ...approvedUser, roles: ["ADMINISTRATOR"], systemRole: "ADMIN" };
  await authorization.requireEventManager(eventA, administrator, { db: dbWith() });
  await assert.rejects(
    authorization.requireQueueAccess(eventA, administrator, { db: dbWith() }),
    (error) => error.code === "EVENT_ROLE_REQUIRED",
  );
});

test("completed-event manager retains management and analytics authorization without a duty", async () => {
  const db = dbWith({ memberships: [membership(eventA, ["EVENT_MANAGER"])], eventStatus: "COMPLETED" });
  const result = await authorization.requireEventManager(eventA, approvedUser, { db });
  assert.equal(result.event.status, "COMPLETED");
});

test("clinical role requires both durable membership and current station duty", async () => {
  const db = dbWith({ memberships: [membership(eventA, ["SCREENER"])] });
  await assert.rejects(
    authorization.requireEventRoleAndDuty(eventA, approvedUser, "SCREENER", { db, stationId: crypto.randomUUID() }),
    (error) => error.code === "CURRENT_DUTY_REQUIRED",
  );
  db.staffAssignment.findFirst = async () => ({ id: crypto.randomUUID(), assignmentRole: "SCREENER" });
  await authorization.requireEventRoleAndDuty(eventA, approvedUser, "SCREENER", { db });
});

test("legacy reviewer membership cannot bypass doctor account eligibility", async () => {
  const duty = { id: crypto.randomUUID(), assignmentRole: "REVIEWER" };
  await assert.rejects(
    authorization.requireEventRoleAndDuty(eventA, approvedUser, "REVIEWER", { db: dbWith({ memberships: [membership(eventA, ["REVIEWER"])], duty }) }),
    (error) => error.code === "DOCTOR_REQUIRED",
  );
  await authorization.requireEventRoleAndDuty(eventA, approvedUser, "REVIEWER", {
    db: dbWith({ memberships: [membership(eventA, ["REVIEWER"], "DOCTOR")], duty }),
  });
});

test("pending and suspended accounts are rejected before event membership", async () => {
  const db = dbWith({ memberships: [membership(eventA, ["EVENT_MANAGER"])] });
  await assert.rejects(
    authorization.requireEventManager(eventA, { ...approvedUser, approvalState: "PENDING" }, { db }),
    (error) => error.code === "ACCOUNT_NOT_OPERATIONAL",
  );
  await assert.rejects(
    authorization.requireEventManager(eventA, { ...approvedUser, accessState: "SUSPENDED" }, { db }),
    (error) => error.code === "ACCOUNT_NOT_OPERATIONAL",
  );
});
