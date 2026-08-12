const asyncHandler = require("../middlewares/asyncHandler");
const referralService = require("../services/screening/referralService");
const adminService = require("../services/account/adminService"); // Ensure adminService is imported
const backupService = require("../services/platform/backupService"); // Dedicated backup service
const {
    processArtifactCleanupTasks,
    listArtifactCleanupTasks,
    maintainArtifactCleanupTask,
} = require("../services/platform/artifactCleanupService");
const { encodeCursor, decodeCursor } = require("../utils/http/cursor");
const { createAuditLog } = require("../utils/logging/audit");
const { drainDueProviderOperations, maintainProviderOperation } = require("../services/account/accountProviderOperationService");

// Keyset cursor pagination helper functions...
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
    res.json(await adminService.getAuditLogs(req.query));
});

exports.runReferralDeliveryMaintenance = asyncHandler(async (req, res) => {
    res.json(await adminService.runReferralDeliveryMaintenance(
        req.body,
        { userId: req.auth.userId, roles: req.auth.roles },
        req.ip,
    ));
});

exports.listArtifactCleanupTasks = asyncHandler(async (req, res) => {
    res.json(await adminService.listArtifactCleanupTasks(req.query, { userId: req.auth.userId, roles: req.auth.roles }));
});

exports.maintainArtifactCleanupTask = asyncHandler(async (req, res) => {
    res.json(await adminService.maintainArtifactCleanupTask(
        req.params.taskId,
        req.body,
        { userId: req.auth.userId, roles: req.auth.roles },
        req.ip,
    ));
});

exports.drainAccountProviderOperations = asyncHandler(async (req, res) => {
    res.json(await adminService.drainAccountProviderOperations(req.body, req.auth.userId, req.context));
});

async function maintainAccountProviderOperation(req, res, action) {
    const result = await adminService.maintainAccountProviderOperation(
        req.params.operationId,
        action,
        req.body.reason,
        req.auth.userId,
        req.context,
    );
    res.status(result.providerOperation?.pending ? 202 : 200).json(result);
}

exports.requeueAccountProviderOperation = asyncHandler(async (req, res) => {
    await maintainAccountProviderOperation(req, res, "REQUEUE");
});

exports.resolveAccountProviderOperation = asyncHandler(async (req, res) => {
    await maintainAccountProviderOperation(req, res, "RESOLVE");
});

/* ==========================================================================
   BACKUP & RECOVERY CONTROLLERS
   ========================================================================== */

exports.listBackups = asyncHandler(async (req, res) => {
    const backups = await backupService.listBackups();
    res.json({ success: true, data: backups });
});

exports.createBackup = asyncHandler(async (req, res) => {
    const result = await backupService.createBackup({
        userId: req.auth.userId,
        ipAddress: req.ip,
        description: req.body.description,
    });
    res.status(201).json({ success: true, ...result });
});

exports.downloadBackup = asyncHandler(async (req, res) => {
    const filePath = await backupService.getBackupFilePath(req.params.backupId);
    res.download(filePath);
});

exports.restoreBackup = asyncHandler(async (req, res) => {
    const result = await backupService.restoreBackup(
        req.params.backupId,
        { userId: req.auth.userId, roles: req.auth.roles },
        req.ip
    );
    res.json({ success: true, ...result });
});

exports.deleteBackup = asyncHandler(async (req, res) => {
    const result = await backupService.deleteBackup(
        req.params.backupId,
        { userId: req.auth.userId, roles: req.auth.roles },
        req.ip
    );
    res.json({ success: true, ...result });
});