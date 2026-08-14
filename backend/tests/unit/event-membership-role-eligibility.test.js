const test = require("node:test");
const assert = require("node:assert/strict");

const { assertRoleEligibility } = require("../../services/event/eventMembershipService");
const { APPLICATION_ROLES, rolesFromCognitoGroups } = require("../../utils/auth/roles");

test("global access contains only administrator and event manager roles", () => {
  assert.deepEqual(APPLICATION_ROLES, ["ADMINISTRATOR", "EVENT_MANAGER"]);
  assert.deepEqual(rolesFromCognitoGroups({ "cognito:groups": ["RegistrationOfficer", "Screener", "Reviewer", "Support"] }), []);
});

test("clinical review is assignable only to doctor accounts", () => {
  assert.doesNotThrow(() => assertRoleEligibility({ professionalCategory: "DOCTOR" }, ["REVIEWER"]));
  assert.doesNotThrow(() => assertRoleEligibility({ professionalCategory: "STAFF" }, ["SCREENER"]));
  assert.throws(
    () => assertRoleEligibility({ professionalCategory: "STAFF" }, ["REVIEWER"]),
    (error) => error.code === "DOCTOR_REQUIRED",
  );
});

test("event duties come from event membership rather than global account roles", () => {
  assert.doesNotThrow(() => assertRoleEligibility({ roles: ["SUPPORT"], professionalCategory: "STAFF" }, ["EVENT_MANAGER"]));
  assert.doesNotThrow(() => assertRoleEligibility({ roles: ["REGISTRATION_OFFICER"], professionalCategory: "STAFF" }, ["SCREENER"]));
});
