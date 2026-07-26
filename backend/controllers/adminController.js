const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");

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
