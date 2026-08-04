const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { synchronizeStaffAccess } = require("./cognitoStaffAccessService");

const userSelect = {
  id: true,
  cognitoSub: true,
  fullName: true,
  email: true,
  employeeNumber: true,
  department: true,
  designation: true,
  status: true,
  sysRole: true,
  createdAt: true,
  userRoles: { select: { role: { select: { id: true, roleName: true } } } },
};

const projectUser = ({ userRoles, sysRole, cognitoSub: _cognitoSub, ...user }) => ({
  ...user,
  systemRole: sysRole,
  roles: userRoles.map(({ role }) => role.roleName),
});

const accountSnapshot = (user) => ({
  status: user.status,
  roles: user.userRoles.map(({ role }) => role.roleName).sort(),
});

const isActiveAdministrator = (user, roles = accountSnapshot(user).roles, status = user.status) =>
  status === "ACTIVE" && roles.includes("ADMINISTRATOR");

async function rolesFor(tx, roleNames) {
  const roles = await tx.role.findMany({
    where: { roleName: { in: roleNames } },
    select: { id: true, roleName: true },
  });
  if (roles.length !== roleNames.length) {
    throw new AppError(422, "ROLE_NOT_AVAILABLE", "One or more account roles are unavailable");
  }
  return roles;
}

async function assertAdminSafety(tx, current, nextRoles, nextStatus, actorId) {
  const currentIsActiveAdmin = isActiveAdministrator(current);
  const nextIsActiveAdmin = isActiveAdministrator(current, nextRoles, nextStatus);
  if (current.id === actorId && !nextIsActiveAdmin) {
    throw new AppError(422, "SELF_ADMIN_CHANGE_BLOCKED", "You cannot remove your own administrator access or deactivate your account");
  }
  if (!currentIsActiveAdmin || nextIsActiveAdmin) return;

  const activeAdministratorCount = await tx.user.count({
    where: {
      status: "ACTIVE",
      userRoles: { some: { role: { roleName: "ADMINISTRATOR" } } },
    },
  });
  if (activeAdministratorCount <= 1) {
    throw new AppError(422, "LAST_ADMIN_CHANGE_BLOCKED", "Keep at least one active administrator account");
  }
}

async function writeAudit(tx, { actorId, action, accountId, before = null, after, context }) {
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action,
      resource: "StaffAccount",
      entityName: "User",
      entityId: accountId,
      oldValue: before,
      newValue: after,
      requestId: context?.requestId,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      deviceName: context?.deviceName || "VSMS staff web",
    },
  });
}

exports.getAllUsers = async () => {
  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
  return users.map(projectUser);
};

async function compensateAndRethrow(synchronization, error) {
  if (synchronization) await synchronization.compensate();
  throw error;
}

exports.createUser = async (userData, actorId, context, accessProvider = synchronizeStaffAccess) => {
  let synchronization;
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: userData.email }, select: { id: true } });
      if (existing) throw new AppError(409, "EMAIL_EXISTS", "Email already registered");

      const roles = await rolesFor(tx, userData.roles);
      synchronization = await accessProvider({
        email: userData.email,
        roles: userData.roles,
        status: userData.status,
      });
      const user = await tx.user.create({
        data: {
          ...(synchronization.cognitoSub ? { cognitoSub: synchronization.cognitoSub } : {}),
          username: userData.email,
          fullName: userData.fullName,
          email: userData.email,
          employeeNumber: userData.employeeNumber,
          department: userData.department ?? null,
          designation: userData.designation ?? null,
          status: userData.status,
          sysRole: userData.roles.includes("ADMINISTRATOR") ? "ADMIN" : userData.roles.includes("EVENT_MANAGER") ? "EVENT_MANAGER" : "STAFF",
          userRoles: { create: roles.map((role) => ({ roleId: role.id, assignedById: actorId })) },
        },
        select: userSelect,
      });
      await writeAudit(tx, {
        actorId,
        action: "STAFF_ACCOUNT_CREATED",
        accountId: user.id,
        after: accountSnapshot(user),
        context,
      });
      return projectUser(user);
    });
  } catch (error) {
    return compensateAndRethrow(synchronization, error);
  }
};

exports.updateUser = async (userId, userData, actorId, context, accessProvider = synchronizeStaffAccess) => {
  let synchronization;
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
      if (!current) throw new AppError(404, "USER_NOT_FOUND", "Staff account not found");

      const currentRoles = accountSnapshot(current).roles;
      const nextRoles = userData.roles || currentRoles;
      const nextStatus = userData.status || current.status;
      await assertAdminSafety(tx, current, nextRoles, nextStatus, actorId);

      let requestedRoles = null;
      if (userData.roles) requestedRoles = await rolesFor(tx, userData.roles);
      if (userData.roles || userData.status !== undefined) {
        synchronization = await accessProvider({
          email: current.email,
          roles: nextRoles,
          status: nextStatus,
        });
        if (current.cognitoSub && synchronization.cognitoSub && current.cognitoSub !== synchronization.cognitoSub) {
          throw new AppError(409, "COGNITO_IDENTITY_MISMATCH", "The Cognito identity does not match this staff account");
        }
      }

      if (requestedRoles) {
        const roleIds = requestedRoles.map(({ id }) => id);
        await tx.userRole.deleteMany({ where: { userId, roleId: { notIn: roleIds } } });
        await tx.userRole.createMany({
          data: requestedRoles.map(({ id }) => ({ userId, roleId: id, assignedById: actorId })),
          skipDuplicates: true,
        });
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(!current.cognitoSub && synchronization?.cognitoSub ? { cognitoSub: synchronization.cognitoSub } : {}),
          ...(userData.fullName !== undefined ? { fullName: userData.fullName } : {}),
          ...(userData.employeeNumber !== undefined ? { employeeNumber: userData.employeeNumber } : {}),
          ...(userData.department !== undefined ? { department: userData.department } : {}),
          ...(userData.designation !== undefined ? { designation: userData.designation } : {}),
          ...(userData.status !== undefined ? { status: userData.status } : {}),
          ...(userData.roles ? { sysRole: nextRoles.includes("ADMINISTRATOR") ? "ADMIN" : nextRoles.includes("EVENT_MANAGER") ? "EVENT_MANAGER" : "STAFF" } : {}),
        },
        select: userSelect,
      });
      await writeAudit(tx, {
        actorId,
        action: "STAFF_ACCOUNT_UPDATED",
        accountId: userId,
        before: accountSnapshot(current),
        after: accountSnapshot(updated),
        context,
      });
      return projectUser(updated);
    });
  } catch (error) {
    return compensateAndRethrow(synchronization, error);
  }
};
