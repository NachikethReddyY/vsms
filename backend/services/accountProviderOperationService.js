const crypto = require("node:crypto");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { resolveAuditContext } = require("../utils/audit");
const { lockAccountTransition } = require("./adminSafety");
const {
  synchronizeStaffAccess,
  revokeStaffSessions,
  disableAndRevokeStaff,
} = require("./cognitoStaffAccessService");

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
const TERMINAL_STATUSES = ["SUCCEEDED", "CANCELED", "ESCALATED", "RESOLVED"];
const PENDING_STATUSES = ["PENDING", "PROCESSING", "FAILED"];

const clock = (overrides) => overrides.now ? overrides.now() : new Date();
const backoffMs = (attemptCount) => Math.min(5 * 60_000, 1000 * (2 ** Math.max(0, attemptCount - 1)));

async function enqueueProviderOperation(tx, { userId, operationType, idempotencyKey, payload = {} }) {
  const existing = await tx.accountProviderOperation.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return tx.accountProviderOperation.update({ where: { id: existing.id }, data: { payload } });
  }
  const user = await tx.user.update({
    where: { id: userId },
    data: { providerStateGeneration: { increment: 1 } },
    select: { providerStateGeneration: true },
  });
  return tx.accountProviderOperation.create({
    data: {
      userId,
      operationType,
      idempotencyKey,
      payload,
      generation: user.providerStateGeneration,
    },
  });
}

async function claimProviderOperation(client, operationId, overrides) {
  const candidate = await client.accountProviderOperation.findUnique({
    where: { id: operationId },
    select: { id: true, userId: true },
  });
  if (!candidate) throw new AppError(404, "PROVIDER_OPERATION_NOT_FOUND", "Provider operation not found");

  return client.$transaction(async (tx) => {
    await lockAccountTransition(tx, candidate.userId);
    const operation = await tx.accountProviderOperation.findUnique({ where: { id: operationId } });
    if (!operation) throw new AppError(404, "PROVIDER_OPERATION_NOT_FOUND", "Provider operation not found");
    if (TERMINAL_STATUSES.includes(operation.status)) return { operation, accepted: false, pending: false };

    const older = await tx.accountProviderOperation.findFirst({
      where: {
        userId: operation.userId,
        generation: { lt: operation.generation },
        status: { in: ["PENDING", "PROCESSING", "FAILED"] },
      },
      orderBy: { generation: "asc" },
    });
    if (older) return { operation, accepted: true, pending: true, reason: "OLDER_GENERATION_PENDING" };

    const now = clock(overrides);
    const leaseMs = overrides.leaseMs ?? LEASE_MS;
    const leaseExpired = operation.status === "PROCESSING"
      && operation.claimedAt
      && operation.claimedAt.getTime() <= now.getTime() - leaseMs;
    if (operation.status === "PROCESSING" && !leaseExpired) {
      return { operation, accepted: true, pending: true, reason: "LEASE_OWNED" };
    }
    if (operation.status === "FAILED" && operation.nextAttemptAt > now && !overrides.force) {
      return { operation, accepted: true, pending: true, reason: "BACKOFF" };
    }
    if (operation.attemptCount >= (overrides.maxAttempts ?? MAX_ATTEMPTS)) {
      const escalated = await tx.accountProviderOperation.update({
        where: { id: operation.id },
        data: { status: "ESCALATED", completedAt: now, claimedAt: null, claimToken: null },
      });
      return { operation: escalated, accepted: false, pending: false };
    }

    const claimToken = crypto.randomUUID();
    const claimed = await tx.accountProviderOperation.update({
      where: { id: operation.id },
      data: {
        status: "PROCESSING",
        claimedAt: now,
        claimToken,
        completedAt: null,
        lastErrorCode: null,
        attemptCount: { increment: 1 },
      },
      include: { user: { select: { id: true, email: true, cognitoSub: true } } },
    });
    return { operation: claimed, claimToken, accepted: true, pending: false };
  });
}

async function invokeProvider(operation, overrides) {
  if (operation.operationType === "SYNC_ACCESS") {
    const synchronization = await (overrides.synchronize || synchronizeStaffAccess)({
      email: operation.user.email,
      roles: operation.payload.roles || [],
      status: operation.payload.status,
    });
    if (operation.user.cognitoSub && synchronization.cognitoSub
      && operation.user.cognitoSub !== synchronization.cognitoSub) {
      await synchronization.compensate();
      throw new AppError(409, "COGNITO_IDENTITY_MISMATCH", "The Cognito identity does not match this staff account");
    }
    return synchronization;
  }
  if (operation.operationType === "DISABLE_AND_SIGN_OUT") {
    await (overrides.disableAndRevoke || disableAndRevokeStaff)(operation.user.email);
    return null;
  }
  await (overrides.revoke || revokeStaffSessions)(operation.user.email);
  return null;
}

async function repairAfterLostClaim(client, staleOperation, overrides) {
  const repair = await client.$transaction(async (tx) => {
    await lockAccountTransition(tx, staleOperation.userId);
    const latest = await tx.accountProviderOperation.findFirst({
      where: { userId: staleOperation.userId, generation: { gt: staleOperation.generation } },
      orderBy: { generation: "desc" },
    });
    if (!latest) return null;
    return enqueueProviderOperation(tx, {
      userId: latest.userId,
      operationType: latest.operationType,
      idempotencyKey: `STALE_REPAIR:${staleOperation.id}:${latest.id}`,
      payload: latest.payload,
    });
  });
  if (repair) return processProviderOperation(repair.id, { ...overrides, force: true });
  return null;
}

async function processProviderOperation(operationId, overrides = {}) {
  const client = overrides.prisma || prisma;
  const claim = await claimProviderOperation(client, operationId, overrides);
  if (!claim.claimToken) return claim;

  let synchronization;
  try {
    synchronization = await invokeProvider(claim.operation, overrides);
    const completedAt = clock(overrides);
    const completion = await client.$transaction(async (tx) => {
      await lockAccountTransition(tx, claim.operation.userId);
      const updated = await tx.accountProviderOperation.updateMany({
        where: {
          id: claim.operation.id,
          generation: claim.operation.generation,
          status: "PROCESSING",
          claimToken: claim.claimToken,
        },
        data: { status: "SUCCEEDED", completedAt, claimedAt: null, claimToken: null, lastErrorCode: null },
      });
      if (updated.count === 1 && synchronization?.cognitoSub && !claim.operation.user.cognitoSub) {
        await tx.user.update({ where: { id: claim.operation.userId }, data: { cognitoSub: synchronization.cognitoSub } });
      }
      return updated.count;
    });
    if (completion === 0) {
      await repairAfterLostClaim(client, claim.operation, overrides);
      return { operation: claim.operation, accepted: true, pending: true, reason: "STALE_COMPLETION_REPAIRED" };
    }
    return {
      operation: await client.accountProviderOperation.findUnique({ where: { id: claim.operation.id } }),
      accepted: true,
      pending: false,
    };
  } catch (error) {
    const now = clock(overrides);
    const maxAttempts = overrides.maxAttempts ?? MAX_ATTEMPTS;
    const nextStatus = claim.operation.attemptCount >= maxAttempts ? "ESCALATED" : "FAILED";
    await client.$transaction(async (tx) => {
      await lockAccountTransition(tx, claim.operation.userId);
      await tx.accountProviderOperation.updateMany({
        where: {
          id: claim.operation.id,
          generation: claim.operation.generation,
          status: "PROCESSING",
          claimToken: claim.claimToken,
        },
        data: {
          status: nextStatus,
          claimedAt: null,
          claimToken: null,
          completedAt: nextStatus === "ESCALATED" ? now : null,
          nextAttemptAt: new Date(now.getTime() + backoffMs(claim.operation.attemptCount)),
          lastErrorCode: String(error.code || error.name || "PROVIDER_OPERATION_FAILED").slice(0, 80),
        },
      });
    });
    throw new AppError(502, "ACCOUNT_PROVIDER_OPERATION_FAILED", "Account state was saved but the identity provider operation must be retried", {
      operationId: claim.operation.id,
    });
  }
}

function providerOperationState(result, fallbackOperation, fallbackReason) {
  const operation = result?.operation || fallbackOperation;
  const status = operation?.status || "PENDING";
  return {
    id: operation.id,
    operationType: operation.operationType,
    generation: operation.generation,
    status,
    pending: Boolean(result?.pending || PENDING_STATUSES.includes(status)),
    ...(result?.reason || fallbackReason ? { reason: result?.reason || fallbackReason } : {}),
  };
}

async function processProviderOperationForResponse(operation, options = {}) {
  if (!operation) return null;
  const { processor = processProviderOperation, ...overrides } = options;
  const client = overrides.prisma || prisma;
  try {
    return providerOperationState(await processor(operation.id, overrides), operation);
  } catch (error) {
    if (error?.code !== "ACCOUNT_PROVIDER_OPERATION_FAILED") throw error;
    const current = await client.accountProviderOperation.findUnique({ where: { id: operation.id } });
    if (current?.status === "ESCALATED") throw error;
    return providerOperationState({ operation: current || operation, pending: true }, operation, "RETRY_QUEUED");
  }
}

function serializeMaintenanceOperation(operation) {
  return {
    id: operation.id,
    userId: operation.userId,
    operationType: operation.operationType,
    status: operation.status,
    generation: operation.generation,
    attemptCount: operation.attemptCount,
    nextAttemptAt: operation.nextAttemptAt,
    completedAt: operation.completedAt,
    lastErrorCode: operation.lastErrorCode,
    resolvedAt: operation.resolvedAt,
    resolutionReason: operation.resolutionReason,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

async function maintainProviderOperation(operationId, action, reason, actorId, context, overrides = {}) {
  const client = overrides.prisma || prisma;
  const normalizedReason = String(reason || "").trim();
  if (!["REQUEUE", "RESOLVE"].includes(action)) {
    throw new AppError(422, "PROVIDER_OPERATION_ACTION_INVALID", "Provider operation maintenance action is invalid");
  }
  if (normalizedReason.length < 10 || normalizedReason.length > 500) {
    throw new AppError(422, "PROVIDER_OPERATION_REASON_INVALID", "A maintenance reason between 10 and 500 characters is required");
  }
  const candidate = await client.accountProviderOperation.findUnique({
    where: { id: operationId },
    select: { id: true, userId: true },
  });
  if (!candidate) throw new AppError(404, "PROVIDER_OPERATION_NOT_FOUND", "Provider operation not found");

  const maintained = await client.$transaction(async (tx) => {
    await lockAccountTransition(tx, candidate.userId);
    const source = await tx.accountProviderOperation.findUnique({ where: { id: operationId } });
    if (!source) throw new AppError(404, "PROVIDER_OPERATION_NOT_FOUND", "Provider operation not found");
    if (source.status !== "ESCALATED") {
      throw new AppError(409, "PROVIDER_OPERATION_NOT_ESCALATED", "Only an escalated provider operation can be requeued or resolved");
    }
    if (action === "REQUEUE") {
      const newer = await tx.accountProviderOperation.findFirst({
        where: { userId: source.userId, generation: { gt: source.generation } },
        select: { id: true },
      });
      if (newer) {
        throw new AppError(409, "PROVIDER_OPERATION_SUPERSEDED", "A superseded provider operation cannot be requeued");
      }
    }

    const now = clock(overrides);
    const changed = await tx.accountProviderOperation.updateMany({
      where: { id: operationId, status: "ESCALATED" },
      data: {
        status: "RESOLVED",
        resolvedAt: now,
        resolutionReason: normalizedReason,
        claimedAt: null,
        claimToken: null,
      },
    });
    if (changed.count !== 1) {
      throw new AppError(409, "PROVIDER_OPERATION_STATE_CONFLICT", "Provider operation changed concurrently");
    }
    const replacement = action === "REQUEUE"
      ? await enqueueProviderOperation(tx, {
          userId: source.userId,
          operationType: source.operationType,
          idempotencyKey: `ADMIN_REQUEUE:${source.id}:${crypto.randomUUID()}`,
          payload: source.payload,
        })
      : null;
    const updated = await tx.accountProviderOperation.findUnique({ where: { id: operationId } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: action === "REQUEUE" ? "ACCOUNT_PROVIDER_OPERATION_REQUEUED" : "ACCOUNT_PROVIDER_OPERATION_RESOLVED",
        resource: "AccountProviderOperation",
        entityName: "AccountProviderOperation",
        entityId: source.id,
        oldValue: {
          status: source.status,
          generation: source.generation,
          attemptCount: source.attemptCount,
          lastErrorCode: source.lastErrorCode,
        },
        newValue: {
          status: updated.status,
          resolutionReason: normalizedReason,
          ...(replacement ? { requeuedOperationId: replacement.id, requeuedGeneration: replacement.generation } : {}),
        },
        ...await resolveAuditContext({ client: tx, userId: actorId, context }),
      },
    });
    return { source: updated, replacement };
  });

  if (!maintained.replacement) {
    return { operation: serializeMaintenanceOperation(maintained.source) };
  }
  const providerOperation = await processProviderOperationForResponse(maintained.replacement, {
    processor: overrides.processor,
    ...overrides.providerOverrides,
    prisma: client,
    force: true,
  });
  const replacement = await client.accountProviderOperation.findUnique({ where: { id: maintained.replacement.id } });
  return {
    operation: serializeMaintenanceOperation(maintained.source),
    requeuedOperation: serializeMaintenanceOperation(replacement || maintained.replacement),
    providerOperation,
  };
}

async function drainDueProviderOperations({ limit = 25 } = {}, overrides = {}) {
  const client = overrides.prisma || prisma;
  const now = clock(overrides);
  const staleBefore = new Date(now.getTime() - (overrides.leaseMs ?? LEASE_MS));
  const candidates = await client.accountProviderOperation.findMany({
    where: {
      ...(overrides.userId ? { userId: overrides.userId } : {}),
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
        { status: "PROCESSING", claimedAt: { lte: staleBefore } },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: Math.min(100, Math.max(1, limit)),
    select: { id: true },
  });
  const summary = { attempted: candidates.length, succeeded: 0, failed: 0, pending: 0, escalated: 0, operations: [] };
  for (const candidate of candidates) {
    try {
      const result = await processProviderOperation(candidate.id, overrides);
      const status = result.operation?.status;
      if (result.pending) summary.pending += 1;
      else if (status === "SUCCEEDED") summary.succeeded += 1;
      else if (status === "ESCALATED") summary.escalated += 1;
      summary.operations.push({ id: candidate.id, status: status || "PROCESSING", pending: result.pending });
    } catch {
      const operation = await client.accountProviderOperation.findUnique({ where: { id: candidate.id } });
      if (operation?.status === "ESCALATED") summary.escalated += 1;
      else summary.failed += 1;
      summary.operations.push({ id: candidate.id, status: operation?.status || "FAILED", pending: false });
    }
  }
  return summary;
}

module.exports = {
  MAX_ATTEMPTS,
  LEASE_MS,
  enqueueProviderOperation,
  processProviderOperation,
  processProviderOperationForResponse,
  maintainProviderOperation,
  drainDueProviderOperations,
};
