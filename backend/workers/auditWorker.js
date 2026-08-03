// workers/auditWorker.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { subscribeToAuditLogs } = require("../services/eventBroker");

subscribeToAuditLogs(async (logData) => {
    try {
        await prisma.auditLog.create({
            data: {
                action: logData.action,
                category: logData.category || "SECURITY",
                entityName: logData.entityName,
                entityId: logData.entityId,
                userId: logData.userId,
                ipAddress: logData.ipAddress,
                userAgent: logData.userAgent,
                changes: logData.changes,
                createdAt: new Date(logData.createdAt),
            },
        });
        console.log(`[EDA Worker] Successfully recorded audit log for: ${logData.action}`);
    } catch (error) {
        console.error("[EDA Worker] Failed to write audit log:", error);
    }
});