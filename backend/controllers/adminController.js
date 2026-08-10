const asyncHandler = require("../middlewares/asyncHandler");
const adminService = require("../services/account/adminService");

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
