const prisma = require("../../prisma/prismaClient");
const referralService = require("../screening/referralService");
const {
    processArtifactCleanupTasks,
    listArtifactCleanupTasks,
    maintainArtifactCleanupTask,
} = require("../platform/artifactCleanupService");
const { encodeCursor, decodeCursor } = require("../../utils/cursor");
const { createAuditLog } = require("../../utils/audit");
const { drainDueProviderOperations, maintainProviderOperation } = require("./accountProviderOperationService");

function pageQuery(cursorValue, filters, limit, sortField, recordId) {
    const where = cursorValue
        ? {
              ...filters,
              OR: [
                  { [sortField]: { lt: new Date(cursorValue.createdAt) } },
                  { [sortField]: new Date(cursorValue.createdAt), [recordId]: { lt: cursorValue.id } },
              ],
          }
        : filters;
    return {
        where,
        orderBy: [{ [sortField]: "desc" }, { [recordId]: "desc" }],
        take: limit + 1,
        include: { user: { select: { id: true, fullName: true, email: true, status: true } } },
    };
}

function pageResult(rows, limit, scope, sortField, recordId) {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
        items,
        nextCursor: hasMore && last
            ? encodeCursor({ scope, createdAt: last[sortField].toISOString(), id: last[recordId] })
            : null,
    };
}

exports.getAuditLogs = async ({ cursor, authCursor, limit, entityName, action, eventType, outcome, from, to }) => {
    const auditScope = "admin-audit";
    const authScope = "admin-auth-audit";
    const auditFilters = {
        ...(entityName ? { entityName } : {}),
        ...(action ? { action } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const authFilters = {
        ...(eventType ? { eventType } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [logs, authLogs] = await Promise.all([
        prisma.auditLog.findMany(pageQuery(decodeCursor(cursor ?? null, auditScope), auditFilters, limit, "createdAt", "id")),
        prisma.authAuditLog.findMany(pageQuery(decodeCursor(authCursor ?? null, authScope), authFilters, limit, "occurredAt", "id")),
    ]);
    const logsPage = pageResult(logs, limit, auditScope, "createdAt", "id");
    const authPage = pageResult(authLogs, limit, authScope, "occurredAt", "id");
    return {
        logs: logsPage.items,
        authLogs: authPage.items,
        nextCursor: logsPage.nextCursor,
        nextAuthCursor: authPage.nextCursor,
    };
};

exports.runReferralDeliveryMaintenance = async (body, actor, ipAddress) => ({
    deliveries: await referralService.reconcileReferralDeliveries(body, actor, ipAddress),
    artifactCleanup: await processArtifactCleanupTasks({ limit: 200 }),
});

exports.listArtifactCleanupTasks = (query, actor) => listArtifactCleanupTasks(query, actor);

exports.maintainArtifactCleanupTask = (taskId, body, actor, ipAddress) => (
    maintainArtifactCleanupTask(taskId, body, actor, ipAddress)
);

exports.drainAccountProviderOperations = async (body, actorId, context) => {
    const summary = await drainDueProviderOperations(body);
    await createAuditLog({
        userId: actorId,
        action: "ACCOUNT_PROVIDER_OPERATIONS_DRAINED",
        entityName: "User",
        entityId: actorId,
        newValue: {
            attempted: summary.attempted,
            succeeded: summary.succeeded,
            failed: summary.failed,
            pending: summary.pending,
            escalated: summary.escalated,
        },
        context,
    });
    return summary;
};

exports.maintainAccountProviderOperation = (operationId, action, reason, actorId, context) => (
    maintainProviderOperation(operationId, action, reason, actorId, context)
);
