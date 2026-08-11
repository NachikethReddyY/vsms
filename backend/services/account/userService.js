const crypto = require("node:crypto");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { resolveAuditContext } = require("../../utils/audit");
const { synchronizeStaffAccess } = require("./cognitoStaffAccessService");
const { assertAdministratorRemains, lockAccountTransition } = require("./adminSafety");
const { enqueueProviderOperation, processProviderOperation, processProviderOperationForResponse } = require("./accountProviderOperationService");
const { deriveLegacyStatus } = require("./accountState");

const userSelect = {
  id: true,
  cognitoSub: true,
  fullName: true,
  email: true,
  employeeNumber: true,
  department: true,
  designation: true,
  professionalCategory: true,
  status: true,
  approvalState: true,
  accessState: true,
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
  status === "ACTIVE"
  && (user.approvalState ?? "APPROVED") === "APPROVED"
  && (user.accessState ?? "ENABLED") === "ENABLED"
  && roles.includes("ADMINISTRATOR");

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

  await assertAdministratorRemains(tx, {
    currentIsAdministrator: currentIsActiveAdmin,
    nextIsAdministrator: nextIsActiveAdmin,
  });
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
      ...await resolveAuditContext({ client: tx, userId: actorId, context }),
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

function mapUniqueConflict(error) {
  if (error?.code === "P2002") {
    throw new AppError(409, "ACCOUNT_FIELD_CONFLICT", "An account already uses one of these unique fields");
  }
  throw error;
}

exports.createUser = async (
  userData,
  actorId,
  context,
  accessProvider = synchronizeStaffAccess,
  operationProcessor = processProviderOperation,
) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: userData.email }, select: userSelect });
      if (existing) {
        const operation = await tx.accountProviderOperation.findFirst({
          where: { userId: existing.id, operationType: "SYNC_ACCESS", status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        const requestedRoles = [...userData.roles].sort();
        const queuedRoles = [...(operation?.payload?.roles || [])].sort();
        if (operation
          && operation.payload?.status === deriveLegacyStatus({
            approvalState: "APPROVED",
            accessState: "ENABLED",
            inactive: userData.status === "INACTIVE",
          })
          && requestedRoles.join("\0") === queuedRoles.join("\0")) {
          return { user: existing, operation };
        }
        throw new AppError(409, "EMAIL_EXISTS", "Email already registered");
      }

      const roles = await rolesFor(tx, userData.roles);
      const accessState = "ENABLED";
      const status = deriveLegacyStatus({
        approvalState: "APPROVED",
        accessState,
        inactive: userData.status === "INACTIVE",
      });
      const user = await tx.user.create({
        data: {
          username: userData.email,
          fullName: userData.fullName,
          email: userData.email,
          employeeNumber: userData.employeeNumber,
          department: userData.department ?? null,
          designation: userData.designation ?? null,
          professionalCategory: userData.professionalCategory,
          status,
          approvalState: "APPROVED",
          accessState,
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
      const operation = await enqueueProviderOperation(tx, {
        userId: user.id,
        operationType: "SYNC_ACCESS",
        idempotencyKey: `SYNC_ACCESS:${user.id}:${crypto.randomUUID()}`,
        payload: { roles: userData.roles, status },
      });
      return { user, operation };
    });
    const providerOperation = await processProviderOperationForResponse(result.operation, {
      processor: operationProcessor,
      synchronize: accessProvider,
      force: true,
    });
    return { ...projectUser(result.user), providerOperation };
  } catch (error) {
    return mapUniqueConflict(error);
  }
};

exports.updateUser = async (
  userId,
  userData,
  actorId,
  context,
  accessProvider = synchronizeStaffAccess,
  operationProcessor = processProviderOperation,
) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockAccountTransition(tx, userId);
      const current = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
      if (!current) throw new AppError(404, "USER_NOT_FOUND", "Staff account not found");

      const currentRoles = accountSnapshot(current).roles;
      const nextRoles = userData.roles || currentRoles;
      const rolesChanged = Boolean(userData.roles)
        && [...nextRoles].sort().join("\0") !== [...currentRoles].sort().join("\0");
      if (current.id === actorId && !isActiveAdministrator(current, nextRoles, current.status)) {
        throw new AppError(422, "SELF_ADMIN_CHANGE_BLOCKED", "You cannot remove your own administrator access or deactivate your account");
      }

      let requestedRoles = null;
      if (userData.roles) requestedRoles = await rolesFor(tx, userData.roles);
      await assertAdminSafety(tx, current, nextRoles, current.status, actorId);

      if (requestedRoles && rolesChanged) {
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
          ...(userData.fullName !== undefined ? { fullName: userData.fullName } : {}),
          ...(userData.employeeNumber !== undefined ? { employeeNumber: userData.employeeNumber } : {}),
          ...(userData.department !== undefined ? { department: userData.department } : {}),
          ...(userData.designation !== undefined ? { designation: userData.designation } : {}),
          ...(userData.professionalCategory !== undefined ? { professionalCategory: userData.professionalCategory } : {}),
          ...(rolesChanged ? { sysRole: nextRoles.includes("ADMINISTRATOR") ? "ADMIN" : nextRoles.includes("EVENT_MANAGER") ? "EVENT_MANAGER" : "STAFF" } : {}),
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
      let operation = null;
      if (userData.roles && !rolesChanged) {
        operation = await tx.accountProviderOperation.findFirst({
          where: { userId, operationType: "SYNC_ACCESS", status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
      } else if (rolesChanged) {
        await tx.accountProviderOperation.updateMany({
          where: { userId, operationType: "SYNC_ACCESS", status: { in: ["PENDING", "FAILED"] } },
          data: { status: "CANCELED", completedAt: new Date() },
        });
        operation = await enqueueProviderOperation(tx, {
          userId,
          operationType: "SYNC_ACCESS",
          idempotencyKey: `SYNC_ACCESS:${userId}:${crypto.randomUUID()}`,
          payload: { roles: nextRoles, status: current.status },
        });
      }
      return { user: updated, operation };
    });
    const providerOperation = result.operation
      ? await processProviderOperationForResponse(result.operation, {
          processor: operationProcessor,
          synchronize: accessProvider,
          force: true,
        })
      : null;
    return { ...projectUser(result.user), ...(providerOperation ? { providerOperation } : {}) };
  } catch (error) {
    return mapUniqueConflict(error);
  }
};
