const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { authorizeOverride, replaceRoute } = require("../../services/screening/routeOverrideService");

const eventId = crypto.randomUUID();
const otherEventId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const userId = crypto.randomUUID();
const user = (roles, systemRole = "STAFF") => ({
  userId,
  roles,
  systemRole,
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
});

const authDb = ({ roles, duty = true, membership = true } = {}) => ({
  event: { findUnique: async ({ where }) => ({ eventId: where.eventId, status: "IN_PROGRESS", version: 1 }) },
  eventMembership: {
    findFirst: async () => membership ? ({
      id: crypto.randomUUID(),
      status: "ACTIVE",
      roles: roles.map((role) => ({ role })),
      user: { professionalCategory: roles.includes("REVIEWER") ? "DOCTOR" : "STAFF" },
    }) : null,
  },
  staffAssignment: { findFirst: async () => duty ? ({ id: crypto.randomUUID() }) : null },
});

test("event managers and administrators receive full override authority without a duty", async () => {
  assert.equal(await authorizeOverride(authDb({ roles: ["EVENT_MANAGER"], duty: false }), eventId, user(["EVENT_MANAGER"], "EVENT_MANAGER")), "FULL");
  assert.equal(await authorizeOverride(authDb({ roles: [], membership: false }), eventId, user(["ADMINISTRATOR"], "ADMIN")), "FULL");
});

test("registration officers and screeners require a current duty and receive next-only authority", async () => {
  assert.equal(await authorizeOverride(authDb({ roles: ["REGISTRATION"] }), eventId, user(["REGISTRATION_OFFICER"])), "NEXT_ONLY");
  assert.equal(await authorizeOverride(authDb({ roles: ["SCREENER"] }), eventId, user(["SCREENER"])), "NEXT_ONLY");
  await assert.rejects(
    authorizeOverride(authDb({ roles: ["SCREENER"], duty: false }), eventId, user(["SCREENER"])),
    (error) => error.status === 403 && error.code === "CURRENT_DUTY_REQUIRED",
  );
});

test("support, reviewers, inactive memberships, and cross-event registrations are denied", async () => {
  for (const role of ["SUPPORT", "REVIEWER"]) {
    await assert.rejects(
      authorizeOverride(authDb({ roles: [role] }), eventId, user([role])),
      (error) => error.status === 403 && error.code === "EVENT_ROLE_REQUIRED",
    );
  }
  await assert.rejects(
    authorizeOverride(authDb({ roles: ["REGISTRATION"], membership: false }), eventId, user(["REGISTRATION_OFFICER"])),
    (error) => error.status === 403 && error.code === "EVENT_ROLE_REQUIRED",
  );

  const tx = authDb({ roles: ["EVENT_MANAGER"] });
  tx.eventRegistration = { findFirst: async ({ where }) => where.eventId === otherEventId ? ({ registrationId }) : null };
  const db = { ...tx, $transaction: async (work) => work(tx) };
  await assert.rejects(
    replaceRoute({
      eventId,
      registrationId,
      stationIds: [crypto.randomUUID()],
      reasonCode: "OPERATIONAL_EXCEPTION",
      expectedVersion: 1,
      user: user(["EVENT_MANAGER"], "EVENT_MANAGER"),
      db,
    }),
    (error) => error.status === 404 && error.code === "REGISTRATION_NOT_FOUND",
  );
});
