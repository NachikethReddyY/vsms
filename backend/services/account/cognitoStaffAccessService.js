const {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} = require("@aws-sdk/client-cognito-identity-provider");

const AppError = require("../../errors/AppError");
const env = require("../../config/env");
const { normalizeApplicationRole } = require("../../utils/auth/roles");

const GROUP_FOR_ROLE = Object.freeze({
  ADMINISTRATOR: "Admin",
  EVENT_MANAGER: "EventManager",
  REGISTRATION_OFFICER: "RegistrationOfficer",
  SCREENER: "Screener",
  REVIEWER: "Reviewer",
  SUPPORT: "Support",
});

const noOpCompensation = async () => {};

function settings(overrides = {}) {
  const mode = overrides.mode || env.COGNITO_STAFF_SYNC_MODE;
  if (mode === "local-only") {
    if (!['development', 'test'].includes(env.NODE_ENV)) {
      throw new AppError(503, "COGNITO_STAFF_SYNC_UNAVAILABLE", "Cognito staff synchronization is required in this environment");
    }
    return { mode };
  }

  const region = overrides.region || env.COGNITO_REGION || env.AWS_REGION;
  const userPoolId = overrides.userPoolId || env.COGNITO_USER_POOL_ID;
  if (!region || !userPoolId) {
    throw new AppError(503, "COGNITO_STAFF_SYNC_UNAVAILABLE", "Cognito staff synchronization is not configured");
  }
  return {
    mode,
    region,
    userPoolId,
    client: overrides.client || new CognitoIdentityProviderClient({ region }),
  };
}

function attributeValue(user, name) {
  return user?.UserAttributes?.find((attribute) => attribute.Name === name)?.Value || null;
}

async function getUser(client, userPoolId, username) {
  try {
    return await client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
  } catch (error) {
    if (error?.name === "UserNotFoundException") return null;
    throw error;
  }
}

async function listGroups(client, userPoolId, username) {
  const names = [];
  let nextToken;
  do {
    const page = await client.send(new AdminListGroupsForUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      ...(nextToken ? { NextToken: nextToken } : {}),
      Limit: 60,
    }));
    names.push(...(page.Groups || []).map(({ GroupName }) => GroupName).filter(Boolean));
    nextToken = page.NextToken;
  } while (nextToken);
  return [...new Set(names)];
}

async function addGroup(client, userPoolId, username, groupName) {
  await client.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: groupName }));
}

async function removeGroup(client, userPoolId, username, groupName) {
  await client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: groupName }));
}

async function reconcileGroups(client, userPoolId, username, desiredRoles) {
  const currentGroups = await listGroups(client, userPoolId, username);
  const desired = new Set(desiredRoles);

  for (const groupName of currentGroups) {
    const role = normalizeApplicationRole(groupName);
    if (role && !desired.has(role)) await removeGroup(client, userPoolId, username, groupName);
  }

  const retainedRoles = new Set(currentGroups.map(normalizeApplicationRole).filter((role) => role && desired.has(role)));
  for (const role of desired) {
    if (!GROUP_FOR_ROLE[role]) throw new AppError(422, "ROLE_NOT_AVAILABLE", `Cognito mapping is unavailable for ${role}`);
    if (!retainedRoles.has(role)) await addGroup(client, userPoolId, username, GROUP_FOR_ROLE[role]);
  }
}

async function restoreExistingUser(client, userPoolId, username, originalGroups) {
  const currentGroups = await listGroups(client, userPoolId, username);
  const original = new Set(originalGroups);
  for (const groupName of currentGroups) {
    if (normalizeApplicationRole(groupName) && !original.has(groupName)) {
      await removeGroup(client, userPoolId, username, groupName);
    }
  }
  const afterRemovals = new Set(await listGroups(client, userPoolId, username));
  for (const groupName of originalGroups) {
    if (!afterRemovals.has(groupName)) await addGroup(client, userPoolId, username, groupName);
  }
}

function synchronizationError(error, compensationFailed = false) {
  if (error instanceof AppError && !compensationFailed) return error;
  return new AppError(
    502,
    compensationFailed ? "COGNITO_STAFF_SYNC_COMPENSATION_FAILED" : "COGNITO_STAFF_SYNC_FAILED",
    compensationFailed
      ? "Cognito staff access could not be restored after a failed update"
      : "Cognito staff access could not be synchronized",
  );
}

async function synchronizeStaffAccess({ email, roles, status }, overrides = {}) {
  const configuration = settings(overrides);
  if (configuration.mode === "local-only") {
    return { managed: false, cognitoSub: null, compensate: noOpCompensation };
  }

  const { client, userPoolId } = configuration;
  const username = String(email).trim().toLowerCase();
  let created = false;
  let originalGroups = [];
  let cognitoUser;

  try {
    cognitoUser = await getUser(client, userPoolId, username);
    if (!cognitoUser) {
      const createdUser = await client.send(new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          { Name: "email", Value: username },
          { Name: "email_verified", Value: "true" },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }));
      cognitoUser = { UserAttributes: createdUser.User?.Attributes || [], Username: createdUser.User?.Username || username };
      created = true;
    } else {
      originalGroups = await listGroups(client, userPoolId, username);
    }

    await reconcileGroups(client, userPoolId, username, status === "ACTIVE" ? roles : []);
  } catch (error) {
    try {
      if (created) {
        await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
      } else if (cognitoUser) {
        await restoreExistingUser(client, userPoolId, username, originalGroups);
      }
    } catch {
      throw synchronizationError(error, true);
    }
    throw synchronizationError(error);
  }

  let compensated = false;
  return {
    managed: true,
    cognitoSub: attributeValue(cognitoUser, "sub"),
    compensate: async () => {
      if (compensated) return;
      compensated = true;
      try {
        if (created) {
          await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
        } else {
          await restoreExistingUser(client, userPoolId, username, originalGroups);
        }
      } catch (error) {
        throw synchronizationError(error, true);
      }
    },
  };
}

async function revokeStaffSessions(email, overrides = {}) {
  const configuration = settings(overrides);
  if (configuration.mode === "local-only") return { managed: false };
  const username = String(email).trim().toLowerCase();
  try {
    await configuration.client.send(new AdminUserGlobalSignOutCommand({
      UserPoolId: configuration.userPoolId,
      Username: username,
    }));
    return { managed: true };
  } catch (error) {
    if (error?.name === "UserNotFoundException") return { managed: true };
    throw synchronizationError(error);
  }
}

async function disableAndRevokeStaff(email, overrides = {}) {
  const configuration = settings(overrides);
  if (configuration.mode === "local-only") return { managed: false };
  const username = String(email).trim().toLowerCase();
  try {
    await configuration.client.send(new AdminDisableUserCommand({
      UserPoolId: configuration.userPoolId,
      Username: username,
    }));
    await configuration.client.send(new AdminUserGlobalSignOutCommand({
      UserPoolId: configuration.userPoolId,
      Username: username,
    }));
    return { managed: true };
  } catch (error) {
    if (error?.name === "UserNotFoundException") return { managed: true };
    throw synchronizationError(error);
  }
}

module.exports = {
  GROUP_FOR_ROLE,
  synchronizeStaffAccess,
  revokeStaffSessions,
  disableAndRevokeStaff,
};
