// services/auditService.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { publishAuditLog } = require("./eventBroker");

// WRITE (Event-Driven / Non-Blocking)
async function recordAuditAction(action, category, entityName, entityId, user, req, changes) {
    const auditPayload = {
        action,
        category: category || "SECURITY",
        entityName,
        entityId,
        userId: user?.id || null,
        ipAddress: req?.ip || "127.0.0.1",
        userAgent: req?.headers?.["user-agent"] || "Unknown",
        changes: changes || {},
        createdAt: new Date().toISOString(),
    };

    publishAuditLog(auditPayload);
}

// READ (Synchronous Database Queries)
async function getAuditLogs(query, user) {
    const { page = 1, limit = 20, entityName, userId, action } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (entityName) where.entityName = entityName;
    if (userId) where.userId = userId;
    if (action) where.action = { contains: action, mode: 'insensitive' };

    const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
            where,
            take: Number(limit),
            skip,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, fullName: true, email: true } } },
        }),
    ]);

    const formattedLogs = logs.map((log) => ({
        id: log.id,
        action: log.action,
        category: log.category || "SECURITY",
        actorEmail: log.user?.email || "System / Anonymous",
        ipAddress: log.ipAddress || "127.0.0.1",
        userAgent: log.userAgent || "Unknown",
        timestamp: log.createdAt,
        details: log.details || JSON.stringify(log.changes || {}),
    }));

    return {
        success: true,
        data: formattedLogs,
        pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) },
    };
}

async function getAuditLogById(id, user) {
    const log = await prisma.auditLog.findUnique({
        where: { id },
        include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    if (!log) {
        const error = new Error('Audit log entry not found');
        error.status = 404;
        throw error;
    }

    return { success: true, data: log };
}

async function getAuditHistoryByEntity(entityName, entityId, user) {
    const history = await prisma.auditLog.findMany({
        where: { entityName, entityId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    return { success: true, data: history };
}

module.exports = {
    getAuditLogs,
    getAuditLogById,
    getAuditHistoryByEntity,
    recordAuditAction,
};