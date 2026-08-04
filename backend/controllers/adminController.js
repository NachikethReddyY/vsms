const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");
const referralService = require("../services/referralService");
const {
    processArtifactCleanupTasks,
    listArtifactCleanupTasks,
    maintainArtifactCleanupTask,
} = require("../services/artifactCleanupService");

exports.getAuditLogs = asyncHandler(async (req, res) => {
    const logs = await prisma.auditLog.findMany({
        include: {
            user: true,
        },
        orderBy: {
            createdAt: "desc",
        },
        take: 100,
    });

    const authLogs = await prisma.authAuditLog.findMany({
        include: {
            user: true,
        },
        orderBy: {
            occurredAt: "desc",
        },
        take: 100,
    });

    res.json({
        logs,
        authLogs,
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
