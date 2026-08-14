const crypto = require("node:crypto");
const prisma = require("../../prisma/prismaClient");
const env = require("../../config/env");
const AppError = require("../../errors/AppError");
const { createAuditLog, createAuthAuditLog, createAuthAuditLogBestEffort } = require("../../utils/logging/audit");
const { assertAdministratorRemains, lockAccountTransition } = require("./adminSafety");
const { deriveLegacyStatus } = require("./accountState");
const { enqueueProviderOperation, processProviderOperationForResponse } = require("./accountProviderOperationService");
const { enqueueAccountLifecycle } = require("./accountLifecycleNotificationService");
const { rolesFromCognitoGroups } = require("../../utils/auth/roles");
const { sessionValidity } = require("../../utils/auth/sessionValidity");
const { AUTH_AUDIT_EVENTS } = require("../../utils/logging/auditEvents");

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
  await createAuditLog({
    userId: actorId,
    action,
    resource: "Account",
    entityName: "User",
    entityId: accountId,
    oldValue: before,
    newValue: after,
    context,
    client: tx,
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

function profileFromIdToken(payload) {
  return {
    cognitoSub: payload.sub,
    email: payload.email || payload["cognito:username"],
    fullName: payload.name || payload.given_name || null,
    employeeNumber: payload["custom:employee_number"] || null,
    department: payload["custom:department"] || null,
    designation: payload["custom:designation"] || null,
  };
}

function canUseLimitedSession(user) {
  if (!user || user.deprovisionedAt) return false;
  if (user.accessState !== undefined) return user.accessState !== "DISABLED";
  return user.status === "ACTIVE";
}

async function establishCognitoSession(profile, accessTokenPayload, allowCreate) {
  const localUser = await exports.syncCognitoUser(profile, { allowCreate });
  if (!canUseLimitedSession(localUser) || !sessionValidity(localUser, accessTokenPayload).valid) {
    throw new AppError(403, "ACCOUNT_SESSION_BLOCKED", "Access denied");
  }
  const localRoles = localUser.userRoles.map((entry) => entry.role.roleName);
  const cognitoRoles = rolesFromCognitoGroups(accessTokenPayload);
  return { localUser, roles: localRoles.filter((role) => cognitoRoles.includes(role)) };
}

exports.getCurrentAccount = async (userId) => projectAccount(await findAccount(prisma, userId));

exports.syncCognitoUser = async (profile, { allowCreate = false } = {}) => {
  const normalizedEmail = String(profile.email || "").trim().toLowerCase();
  const identityMatches = [];
  if (profile.cognitoSub) identityMatches.push({ cognitoSub: profile.cognitoSub });
  if (normalizedEmail) identityMatches.push({ email: normalizedEmail });

  let user = identityMatches.length
    ? await prisma.user.findFirst({ where: { OR: identityMatches } })
    : null;

  if (!user && !allowCreate) {
    throw new AppError(403, "LOCAL_PROFILE_NOT_FOUND", "Access denied");
  }

  if (!user) {
    const data = {
      cognitoSub: profile.cognitoSub || null,
      username: normalizedEmail,
      fullName: profile.fullName || "Pending Staff",
      email: normalizedEmail,
      employeeNumber: profile.employeeNumber || null,
      department: profile.department || null,
      designation: profile.designation || null,
      status: "INACTIVE",
      sysRole: "STAFF",
      approvalState: "PENDING",
      accessState: "ENABLED",
    };
    if (env.lifecycleEmailEnabled) {
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data });
        await enqueueAccountLifecycle({ type: "SIGNUP_RECEIVED", account: created, idempotencyKey: `SIGNUP_RECEIVED:${created.id}`, db: tx });
        return created;
      });
    } else {
      user = await prisma.user.create({ data });
    }
  } else {
    const update = {};
    if (profile.cognitoSub && !user.cognitoSub) update.cognitoSub = profile.cognitoSub;
    if (profile.fullName) update.fullName = profile.fullName;
    if (profile.employeeNumber) update.employeeNumber = profile.employeeNumber;
    if (profile.department !== undefined) update.department = profile.department || null;
    if (profile.designation !== undefined) update.designation = profile.designation || null;
    if (Object.keys(update).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: update });
    }
  }

  return prisma.user.findUnique({
    where: { id: user.id },
    include: { userRoles: { include: { role: true } } },
  });
};

exports.recordSuccessfulLogin = async (userId, lastLoginAt = new Date()) => {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt } });
  return lastLoginAt;
};

exports.recordAuthAudit = (entry) => createAuthAuditLog(entry);
exports.recordAuthAuditBestEffort = (entry) => createAuthAuditLogBestEffort(entry);

exports.establishCognitoLoginSession = async ({ idTokenPayload, accessTokenPayload, context }) => {
  const emailVerified = idTokenPayload.email_verified === true || idTokenPayload.email_verified === "true";
  const session = await establishCognitoSession(
    profileFromIdToken(idTokenPayload),
    accessTokenPayload,
    env.publicSignupEnabled && emailVerified,
  );
  session.localUser.lastLoginAt = await exports.recordSuccessfulLogin(session.localUser.id);
  await exports.recordAuthAudit({
    userId: session.localUser.id,
    eventType: AUTH_AUDIT_EVENTS.LOGIN_SUCCESS,
    outcome: "SUCCESS",
    identifier: session.localUser.email,
    context,
  });
  return session;
};

exports.establishCognitoRefreshSession = ({ accessTokenPayload, username }) => establishCognitoSession({
  cognitoSub: accessTokenPayload.sub,
  email: username.includes("@") ? username : null,
}, accessTokenPayload, false);

exports.recordPasswordChange = async ({ userId, email, context, changedAt = new Date() }) => {
  await exports.recordAuthAudit({
    userId,
    eventType: AUTH_AUDIT_EVENTS.PASSWORD_CHANGE_SUCCESS,
    outcome: "SUCCESS",
    identifier: email,
    context,
  });
  await enqueueAccountLifecycle({
    type: "PASSWORD_CHANGED",
    account: { id: userId },
    metadata: { changedAt: changedAt.toISOString() },
    idempotencyKey: `PASSWORD_CHANGED:${userId}:${context?.requestId || crypto.randomUUID()}`,
  });
};

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

exports.decideApproval = async (userId, decision, reason, actorId, context, enqueue = enqueueAccountLifecycle, options = {}) => {
  if (decision === "REJECTED" && !String(reason || "").trim()) {
    throw new AppError(422, "REJECTION_REASON_REQUIRED", "A rejection reason is required");
  }
  const result = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, userId);
    const before = await findAccount(tx, userId);
    if (before.deprovisionedAt) throw new AppError(409, "ACCOUNT_DEPROVISIONED", "A disabled account cannot be approved or rejected");
    const allowed = decision === "APPROVED"
      ? before.approvalState === "PENDING"
      : ["PENDING", "APPROVED"].includes(before.approvalState);
    if (!allowed) {
      throw new AppError(409, "INVALID_APPROVAL_TRANSITION", `Account cannot transition from ${before.approvalState.toLowerCase()} to ${decision.toLowerCase()}`);
    }
    let assignedRoles = before.userRoles.map(({ role }) => role.roleName);
    if (decision === "APPROVED") {
      assignedRoles = options.roles;
      if (!Array.isArray(assignedRoles)) assignedRoles = [];
      const roles = await tx.role.findMany({
        where: { roleName: { in: assignedRoles } },
        select: { id: true, roleName: true },
      });
      if (roles.length !== assignedRoles.length) {
        throw new AppError(422, "ROLE_NOT_AVAILABLE", "One or more account roles are unavailable");
      }
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: roles.map(({ id }) => ({ userId, roleId: id, assignedById: actorId })),
      });
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
      data: {
        approvalState: decision,
        status: nextStatus,
        ...(decision === "APPROVED" ? {
          sysRole: assignedRoles.includes("ADMINISTRATOR") ? "ADMIN" : assignedRoles.includes("EVENT_MANAGER") ? "EVENT_MANAGER" : "STAFF",
        } : {}),
      },
      select: accountSelect,
    });
    await writeAudit(tx, actorId, userId, `ACCOUNT_${decision}`, {
      approvalState: before.approvalState,
    }, { approvalState: decision, reason: reason || null, ...(decision === "APPROVED" ? { roles: assignedRoles } : {}) }, context);
    await enqueue({
      type: decision,
      account: projectAccount(updated),
      idempotencyKey: `ACCOUNT_DECISION:${approvalDecision?.id || `${userId}:${decision}:${updated.updatedAt?.getTime() || "CURRENT"}`}`,
      db: tx,
    });
    const operation = decision === "APPROVED"
      ? await enqueueProviderOperation(tx, {
          userId,
          operationType: "SYNC_ACCESS",
          idempotencyKey: `SYNC_ACCESS:${userId}:APPROVE:${approvalDecision.id}`,
          payload: { roles: assignedRoles, status: nextStatus },
        })
      : null;
    return { account: updated, operation };
  });
  const providerOperation = await processAfterCommit(result.operation, options);
  return { ...projectAccount(result.account), ...(providerOperation ? { providerOperation } : {}) };
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
    const restoring = action === "reactivate" && Boolean(before.deprovisionedAt);
    if ((before.deprovisionedAt || before.accessState === "DISABLED") && !restoring) {
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
    if (action === "reactivate" && before.accessState !== "SUSPENDED" && !dormantReactivation && !restoring) {
      throw new AppError(409, "ACCOUNT_NOT_SUSPENDED", "Only a suspended account can be reactivated");
    }
    if (action === "suspend" && before.status !== "ACTIVE") {
      throw new AppError(409, "ACCOUNT_NOT_ACTIVE", "Only an active account can be suspended");
    }
    const nextStatus = deriveLegacyStatus({
      approvalState: before.approvalState,
      accessState: nextAccessState,
      deprovisionedAt: restoring ? null : before.deprovisionedAt,
    });
    await protectAdministratorTransition(tx, before, actorId, { accessState: nextAccessState, status: nextStatus });
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        accessState: nextAccessState,
        status: nextStatus,
        ...(restoring ? { deprovisionedAt: null, deprovisionedById: null, deprovisionReason: null } : {}),
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
