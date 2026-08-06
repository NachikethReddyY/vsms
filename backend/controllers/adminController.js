const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");
const referralService = require("../services/referralService");
const {
    processArtifactCleanupTasks,
    listArtifactCleanupTasks,
    maintainArtifactCleanupTask,
} = require("../services/artifactCleanupService");
const { encodeCursor, decodeCursor } = require("../utils/cursor");

// Keyset cursor pagination so reads stay O(page) and bounded even when the
// audit tables grow to tens of thousands of rows. Both audit tables share the
// (createdAt desc, id desc) ordering; index-backed.
function pageQuery(cursorValue, filters, limit, scope, sortField, recordId) {
    const where = cursorValue
        ? {
              ...filters,
              OR: [
                  { [sortField]: { lt: new Date(cursorValue.createdAt) } },
                  {
                      [sortField]: new Date(cursorValue.createdAt),
                      [recordId]: { lt: cursorValue.id },
                  },
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
        nextCursor:
            hasMore && last
                ? encodeCursor({
                      scope,
                      createdAt: last[sortField].toISOString(),
                      id: last[recordId],
                  })
                : null,
    };
}

exports.getAuditLogs = asyncHandler(async (req, res) => {
    const { cursor, authCursor, limit, entityName, action, eventType, outcome, from, to } = req.query;

    const auditScope = "admin-audit";
    const authScope = "admin-auth-audit";
    const auditCursor = decodeCursor(cursor ?? null, auditScope);
    const authPageCursor = decodeCursor(authCursor ?? null, authScope);

    const auditFilters = {
        ...(entityName ? { entityName } : {}),
        ...(action ? { action } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from || to
            ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
    };

    const authFilters = {
        ...(eventType ? { eventType } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from || to
            ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
    };

    const [logs, authLogs] = await Promise.all([
        prisma.auditLog.findMany(
            pageQuery(auditCursor, auditFilters, limit, auditScope, "createdAt", "id")
        ),
        prisma.authAuditLog.findMany(
            pageQuery(authPageCursor, authFilters, limit, authScope, "occurredAt", "id")
        ),
    ]);

    const logsPage = pageResult(logs, limit, auditScope, "createdAt", "id");
    const authPage = pageResult(authLogs, limit, authScope, "occurredAt", "id");

    res.json({
        logs: logsPage.items,
        authLogs: authPage.items,
        nextCursor: logsPage.nextCursor,
        nextAuthCursor: authPage.nextCursor,
    });
});

exports.runReferralDeliveryMaintenance = asyncHandler(async (req, res) => {
    const deliveries = await referralService.reconcileReferralDeliveries(
        req.body,
        { userId: req.auth.userId, roles: req.auth.roles },
        req.ip,
    );
    const artifactCleanup = await processArtifactCleanupTasks({ limit: 200 });
    res.json({ deliveries, artifactCleanup });
});

exports.listArtifactCleanupTasks = asyncHandler(async (req, res) => {
    res.json(await listArtifactCleanupTasks(req.query, { userId: req.auth.userId, roles: req.auth.roles }));
});

exports.maintainArtifactCleanupTask = asyncHandler(async (req, res) => {
    res.json(await maintainArtifactCleanupTask(
        req.params.taskId,
        req.body,
        { userId: req.auth.userId, roles: req.auth.roles },
        req.ip,
    ));
});
