const test = require("node:test");
const assert = require("node:assert/strict");

const { assertRoleEligibility } = require("../../services/event/eventMembershipService");

test("clinical review is assignable only to doctor accounts", () => {
  assert.doesNotThrow(() => assertRoleEligibility({ professionalCategory: "DOCTOR" }, ["REVIEWER"]));
  assert.doesNotThrow(() => assertRoleEligibility({ professionalCategory: "STAFF" }, ["SCREENER"]));
  assert.throws(
    () => assertRoleEligibility({ professionalCategory: "STAFF" }, ["REVIEWER"]),
    (error) => error.code === "DOCTOR_REQUIRED",
  );
});

test("event management is assignable only to event manager accounts", () => {
  assert.doesNotThrow(() => assertRoleEligibility({ roles: ["EVENT_MANAGER"], professionalCategory: "STAFF" }, ["EVENT_MANAGER"]));
  assert.throws(
    () => assertRoleEligibility({ roles: ["SUPPORT"], professionalCategory: "STAFF" }, ["EVENT_MANAGER"]),
    (error) => error.code === "EVENT_MANAGER_ACCOUNT_REQUIRED",
  );
});
