const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { synchronizeStaffAccess } = require("../../services/cognitoStaffAccessService");

class FakeCognitoClient {
  constructor({ exists = true, groups = [] } = {}) {
    this.exists = exists;
    this.groups = new Set(groups);
    this.sub = crypto.randomUUID();
    this.calls = [];
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    this.calls.push([name, input]);
    if (name === "AdminGetUserCommand") {
      if (!this.exists) throw Object.assign(new Error("missing"), { name: "UserNotFoundException" });
      return { Username: input.Username, UserAttributes: [{ Name: "sub", Value: this.sub }] };
    }
    if (name === "AdminCreateUserCommand") {
      this.exists = true;
      return { User: { Username: input.Username, Attributes: [{ Name: "sub", Value: this.sub }] } };
    }
    if (name === "AdminDeleteUserCommand") {
      this.exists = false;
      this.groups.clear();
      return {};
    }
    if (name === "AdminDisableUserCommand") return {};
    if (name === "AdminListGroupsForUserCommand") {
      return { Groups: [...this.groups].map((GroupName) => ({ GroupName })) };
    }
    if (name === "AdminAddUserToGroupCommand") {
      this.groups.add(input.GroupName);
      return {};
    }
    if (name === "AdminRemoveUserFromGroupCommand") {
      this.groups.delete(input.GroupName);
      return {};
    }
    if (name === "AdminUserGlobalSignOutCommand") return {};
    throw new Error(`Unexpected command ${name}`);
  }
}

const options = (client) => ({
  mode: "required",
  region: "ap-southeast-1",
  userPoolId: "ap-southeast-1_test",
  client,
});

test("administrator session revocation uses Cognito global sign-out without network access", async () => {
  const client = new FakeCognitoClient();
  const { revokeStaffSessions } = require("../../services/cognitoStaffAccessService");
  const result = await revokeStaffSessions("person@example.com", options(client));
  assert.deepEqual(result, { managed: true });
  assert.deepEqual(client.calls.at(-1), ["AdminUserGlobalSignOutCommand", {
    UserPoolId: "ap-southeast-1_test",
    Username: "person@example.com",
  }]);
});

test("deprovision disables the Cognito identity before global sign-out", async () => {
  const client = new FakeCognitoClient();
  const { disableAndRevokeStaff } = require("../../services/cognitoStaffAccessService");
  await disableAndRevokeStaff("person@example.com", options(client));
  assert.deepEqual(client.calls.slice(-2).map(([name]) => name), [
    "AdminDisableUserCommand",
    "AdminUserGlobalSignOutCommand",
  ]);
});

test("Cognito staff synchronization normalizes existing groups and restores them on compensation", async () => {
  const client = new FakeCognitoClient({ groups: ["ADMIN", "Support", "Unrelated"] });
  const result = await synchronizeStaffAccess({
    email: "manager@example.com",
    roles: ["EVENT_MANAGER"],
    status: "ACTIVE",
  }, options(client));

  assert.equal(result.cognitoSub, client.sub);
  assert.deepEqual([...client.groups].sort(), ["EventManager", "Unrelated"]);
  await result.compensate();
  assert.deepEqual([...client.groups].sort(), ["ADMIN", "Support", "Unrelated"]);
});

test("Cognito staff synchronization creates a missing Support identity and deletes it on compensation", async () => {
  const client = new FakeCognitoClient({ exists: false });
  const result = await synchronizeStaffAccess({
    email: "support@example.com",
    roles: ["SUPPORT"],
    status: "ACTIVE",
  }, options(client));

  assert.equal(client.exists, true);
  assert.deepEqual([...client.groups], ["Support"]);
  assert.equal(result.cognitoSub, client.sub);
  await result.compensate();
  assert.equal(client.exists, false);
  assert.deepEqual([...client.groups], []);
});

test("inactive staff retain no application Cognito groups", async () => {
  const client = new FakeCognitoClient({ groups: ["Reviewer", "Unrelated"] });
  await synchronizeStaffAccess({
    email: "reviewer@example.com",
    roles: ["REVIEWER"],
    status: "INACTIVE",
  }, options(client));

  assert.deepEqual([...client.groups], ["Unrelated"]);
});
