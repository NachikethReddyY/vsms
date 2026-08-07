const crypto = require("node:crypto");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { resolveAuditContext } = require("../utils/audit");
const { assertAdministratorRemains, lockAccountTransition } = require("./adminSafety");
const { deriveLegacyStatus } = require("./accountState");
const { enqueueProviderOperation, processProviderOperationForResponse } = require("./accountProviderOperationService");
const { enqueueAccountLifecycle } = require("./accountLifecycleNotificationService");

const summarySelect = {
  id: true,
  fullName: true,
  email: true,
  contactNumber: true,
  employeeNumber: true,
  department: true,
  designation: true,
  professionalCategory: true,
  approvalState: true,
  accessState: true,
  status: true,
  lastLoginAt: true,
  sessionInvalidBefore: true,
  deprovisionedAt: true,
  deprovisionReason: true,
  createdAt: true,
  updatedAt: true,
};

const membershipInclude = {
  orderBy: [{ addedAt: "desc" }],
  include: {
    event: { select: { eventId: true, name: true, status: true, startsAt: true, endsAt: true } },
    roles: { select: { role: true, assignedAt: true }, orderBy: { role: "asc" } },
  },
};

const accountSelect = {
  ...summarySelect,
  userRoles: { select: { role: { select: { roleName: true } } } },
  eventMemberships: membershipInclude,
};

function projectAccount(account) {
  const { userRoles = [], ...safe } = account;
  return { ...safe, roles: userRoles.map(({ role }) => role.roleName).sort() };
}

function activeAdministrator(account, overrides = {}) {
  const roles = account.userRoles?.map(({ role }) => role.roleName) || [];
  return (overrides.status ?? account.status) === "ACTIVE"
    && (overrides.approvalState ?? account.approvalState) === "APPROVED"
    && (overrides.accessState ?? account.accessState) === "ENABLED"
    && !(overrides.deprovisionedAt ?? account.deprovisionedAt)
    && roles.includes("ADMINISTRATOR");
}

async function writeAudit(tx, actorId, accountId, action, before, after, context) {
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action,
      resource: "Account",
      entityName: "User",
      entityId: accountId,
      oldValue: before,
      newValue: after,
      ...await resolveAuditContext({ client: tx, userId: actorId, context }),
    },
  });
}

async function findAccount(tx, userId) {
  const account = await tx.user.findUnique({ where: { id: userId }, select: accountSelect });
  if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account not found");
  return account;
}

async function findRetryableOperation(tx, userId, operationType) {
  return tx.accountProviderOperation.findFirst({
    where: { userId, operationType, status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

async function processAfterCommit(operation, options = {}) {
  if (!operation) return null;
  return processProviderOperationForResponse(operation, {
    processor: options.processProviderOperation,
    ...options.providerOverrides,
    force: true,
  });
}

async function protectAdministratorTransition(tx, account, actorId, overrides) {
  const currentIsAdministrator = activeAdministrator(account);
  const nextIsAdministrator = activeAdministrator(account, overrides);
  if (account.id === actorId && currentIsAdministrator && !nextIsAdministrator) {
    throw new AppError(422, "SELF_ADMIN_CHANGE_BLOCKED", "You cannot remove your own administrator access or deactivate your account");
  }
  await assertAdministratorRemains(tx, { currentIsAdministrator, nextIsAdministrator });
}

exports.getCurrentAccount = async (userId) => projectAccount(await findAccount(prisma, userId));

exports.updateCurrentAccount = async (userId, data, context) => prisma.$transaction(async (tx) => {
  await lockAccountTransition(tx, userId);
  const before = await findAccount(tx, userId);
  if (before.deprovisionedAt) throw new AppError(403, "ACCOUNT_DEPROVISIONED", "This account is disabled");
  const account = await tx.user.update({
    where: { id: userId },
    data,
    select: accountSelect,
  });
  await writeAudit(tx, userId, userId, "ACCOUNT_PROFILE_UPDATED", null, {
    fields: Object.keys(data).sort(),
  }, context);
  return projectAccount(account);
});

exports.listAccounts = async ({ page, limit, search, approvalState, accessState, professionalCategory, eventRole }) => {
  const where = {
    ...(search ? {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { employeeNumber: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
    ...(approvalState ? { approvalState } : {}),
    ...(accessState ? { accessState } : {}),
    ...(professionalCategory ? { professionalCategory } : {}),
    ...(eventRole ? {
      eventMemberships: { some: { status: "ACTIVE", roles: { some: { role: eventRole } } } },
    } : {}),
  };
  const [total, accounts, pendingCount] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        ...summarySelect,
        userRoles: { select: { role: { select: { roleName: true } } } },
        _count: { select: { eventMemberships: { where: { status: "ACTIVE" } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where: { approvalState: "PENDING", deprovisionedAt: null } }),
  ]);
  return {
    items: accounts.map(projectAccount),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    pendingCount,
  };
};

exports.getAccount = async (userId) => {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...accountSelect,
      approvalDecisions: {
        orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
        include: { decidedBy: { select: { id: true, fullName: true, email: true } } },
      },
      providerOperations: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
        select: {
          id: true,
          operationType: true,
          status: true,
          generation: true,
          attemptCount: true,
          nextAttemptAt: true,
          completedAt: true,
          lastErrorCode: true,
          resolvedAt: true,
          resolutionReason: true,
          createdAt: true,
        },
      },
      lifecycleEmails: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
        select: {
          id: true,
          purpose: true,
          provider: true,
          templateVersion: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          nextAttemptAt: true,
          acceptedAt: true,
          failedAt: true,
          failureCode: true,
          createdAt: true,
        },
      },
    },
  });
  if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account not found");
  return projectAccount(account);
};

exports.decideApproval = async (userId, decision, reason, actorId, context, enqueue = enqueueAccountLifecycle) => {
  if (decision === "REJECTED" && !String(reason || "").trim()) {
    throw new AppError(422, "REJECTION_REASON_REQUIRED", "A rejection reason is required");
  }
  const account = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, userId);
    const before = await findAccount(tx, userId);
    if (before.deprovisionedAt) throw new AppError(409, "ACCOUNT_DEPROVISIONED", "A disabled account cannot be approved or rejected");
    const allowed = decision === "APPROVED"
      ? before.approvalState === "PENDING"
      : ["PENDING", "APPROVED"].includes(before.approvalState);
    if (!allowed) {
      throw new AppError(409, "INVALID_APPROVAL_TRANSITION", `Account cannot transition from ${before.approvalState.toLowerCase()} to ${decision.toLowerCase()}`);
    }
    const nextStatus = deriveLegacyStatus({
      approvalState: decision,
      accessState: before.accessState,
      deprovisionedAt: before.deprovisionedAt,
    });
    await protectAdministratorTransition(tx, before, actorId, { approvalState: decision, status: nextStatus });
    const approvalDecision = await tx.accountApprovalDecision.create({
      data: { userId, decision, decidedById: actorId, reason: reason || null },
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: { approvalState: decision, status: nextStatus },
      select: accountSelect,
    });
    await writeAudit(tx, actorId, userId, `ACCOUNT_${decision}`, {
      approvalState: before.approvalState,
    }, { approvalState: decision, reason: reason || null }, context);
    await enqueue({
      type: decision,
      account: projectAccount(updated),
      idempotencyKey: `ACCOUNT_DECISION:${approvalDecision?.id || `${userId}:${decision}:${updated.updatedAt?.getTime() || "CURRENT"}`}`,
      db: tx,
    });
    return updated;
  });
  return projectAccount(account);
};

exports.changeAccess = async (userId, action, reason, actorId, context, options = {}) => {
  if (!["suspend", "reactivate"].includes(action)) throw new AppError(422, "INVALID_ACCESS_ACTION", "Access action is invalid");
  if (action === "suspend" && !String(reason || "").trim()) {
    throw new AppError(422, "SUSPENSION_REASON_REQUIRED", "A suspension reason is required");
  }
  const enqueue = options.enqueue || enqueueAccountLifecycle;
  const nextAccessState = action === "suspend" ? "SUSPENDED" : "ENABLED";
  const invalidBefore = action === "suspend" ? new Date() : undefined;
  const result = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, userId);
    const before = await findAccount(tx, userId);
    if (before.deprovisionedAt || before.accessState === "DISABLED") {
      throw new AppError(409, "ACCOUNT_DISABLED", "A disabled account cannot change access state");
    }
    if (before.approvalState !== "APPROVED") {
      throw new AppError(409, "ACCOUNT_NOT_APPROVED", "Only an approved account can be suspended or reactivated");
    }
    const dormantReactivation = action === "reactivate"
      && before.accessState === "ENABLED"
      && before.status === "INACTIVE";
    if (before.accessState === nextAccessState && !dormantReactivation) {
      if (action === "suspend") {
        const operation = await findRetryableOperation(tx, userId, "GLOBAL_SIGN_OUT");
        if (operation) return { account: before, operation };
      }
      throw new AppError(409, "ACCESS_STATE_UNCHANGED", `Account access is already ${nextAccessState.toLowerCase()}`);
    }
    if (action === "reactivate" && before.accessState !== "SUSPENDED" && !dormantReactivation) {
      throw new AppError(409, "ACCOUNT_NOT_SUSPENDED", "Only a suspended account can be reactivated");
    }
    if (action === "suspend" && before.status !== "ACTIVE") {
      throw new AppError(409, "ACCOUNT_NOT_ACTIVE", "Only an active account can be suspended");
    }
    const nextStatus = deriveLegacyStatus({
      approvalState: before.approvalState,
      accessState: nextAccessState,
      deprovisionedAt: before.deprovisionedAt,
    });
    await protectAdministratorTransition(tx, before, actorId, { accessState: nextAccessState, status: nextStatus });
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        accessState: nextAccessState,
        status: nextStatus,
        ...(invalidBefore ? { sessionInvalidBefore: invalidBefore } : {}),
      },
      select: accountSelect,
    });
    await writeAudit(tx, actorId, userId, action === "suspend" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REACTIVATED", {
      accessState: before.accessState,
    }, { accessState: nextAccessState, reason: reason || null }, context);
    const operation = invalidBefore
      ? await enqueueProviderOperation(tx, {
          userId,
          operationType: "GLOBAL_SIGN_OUT",
          idempotencyKey: `GLOBAL_SIGN_OUT:${userId}:${invalidBefore.getTime()}`,
        })
      : await enqueueProviderOperation(tx, {
          userId,
          operationType: "SYNC_ACCESS",
          idempotencyKey: `SYNC_ACCESS:${userId}:REACTIVATE:${crypto.randomUUID()}`,
          payload: {
            roles: updated.userRoles.map(({ role }) => role.roleName),
            status: nextStatus,
          },
        });
    await enqueue({
      type: action === "suspend" ? "SUSPENDED" : "REACTIVATED",
      account: projectAccount(updated),
      idempotencyKey: `ACCOUNT_ACCESS:${userId}:${updated.updatedAt.getTime()}`,
      db: tx,
    });
    return { account: updated, operation };
  });
  const providerOperation = await processAfterCommit(result.operation, options);
  return { ...projectAccount(result.account), providerOperation };
};

exports.revokeSessions = async (userId, actorId, context, options = {}) => {
  const result = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, userId);
    const before = await findAccount(tx, userId);
    if (before.deprovisionedAt) throw new AppError(409, "ACCOUNT_DEPROVISIONED", "A disabled account cannot revoke sessions again");
    const sessionInvalidBefore = new Date();
    const updated = await tx.user.update({
      where: { id: userId },
      data: { sessionInvalidBefore },
      select: accountSelect,
    });
    await writeAudit(tx, actorId, userId, "ACCOUNT_SESSIONS_REVOKED", null, { sessionInvalidBefore }, context);
    const operation = await enqueueProviderOperation(tx, {
      userId,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `GLOBAL_SIGN_OUT:${userId}:${sessionInvalidBefore.getTime()}:${crypto.randomUUID()}`,
    });
    return { account: updated, operation };
  });
  const providerOperation = await processAfterCommit(result.operation, options);
  return { ...projectAccount(result.account), providerOperation };
};

exports.deprovision = async (userId, reason, actorId, context, options = {}) => {
  if (!String(reason || "").trim()) throw new AppError(422, "DEPROVISION_REASON_REQUIRED", "A deprovision reason is required");
  const enqueue = options.enqueue || enqueueAccountLifecycle;
  const result = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, userId);
    const before = await findAccount(tx, userId);
    if (before.deprovisionedAt) {
      const operation = await findRetryableOperation(tx, userId, "DISABLE_AND_SIGN_OUT");
      if (operation) return { account: before, operation };
      throw new AppError(409, "ACCOUNT_ALREADY_DEPROVISIONED", "Account is already disabled");
    }
    const now = new Date();
    const nextStatus = deriveLegacyStatus({
      approvalState: before.approvalState,
      accessState: "DISABLED",
      deprovisionedAt: now,
    });
    await protectAdministratorTransition(tx, before, actorId, {
      accessState: "DISABLED",
      status: nextStatus,
      deprovisionedAt: now,
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        accessState: "DISABLED",
        status: nextStatus,
        sessionInvalidBefore: now,
        deprovisionedAt: now,
        deprovisionedById: actorId,
        deprovisionReason: reason,
      },
      select: accountSelect,
    });
    await writeAudit(tx, actorId, userId, "ACCOUNT_DEPROVISIONED", {
      accessState: before.accessState,
    }, { accessState: "DISABLED", reason }, context);
    await enqueue({
      type: "DEPROVISIONED",
      account: projectAccount(updated),
      idempotencyKey: `ACCOUNT_DEPROVISIONED:${userId}:${now.getTime()}`,
      db: tx,
    });
    const operation = await enqueueProviderOperation(tx, {
      userId,
      operationType: "DISABLE_AND_SIGN_OUT",
      idempotencyKey: `DISABLE_AND_SIGN_OUT:${userId}`,
    });
    return { account: updated, operation };
  });
  const providerOperation = await processAfterCommit(result.operation, options);
  return { ...projectAccount(result.account), providerOperation };
};

exports.resendLifecycle = async (userId, actorId, context, enqueue = enqueueAccountLifecycle) => {
  const account = await findAccount(prisma, userId);
  const result = await enqueue({ account: projectAccount(account), force: true });
  await prisma.$transaction((tx) => writeAudit(tx, actorId, userId, "ACCOUNT_LIFECYCLE_RESEND_REQUESTED", null, {
    approvalState: account.approvalState,
    queued: Boolean(result?.queued),
  }, context));
  return result || { queued: false };
};
