const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const prisma = require("../prisma/prismaClient");
const { sanitizeMetadata } = require("./sanitize");

function trimValue(value, maxLength) {
    if (!value) {
        return null;
    }

    return String(value).slice(0, maxLength);
}

function hashIdentifier(identifier) {
    if (!identifier) {
        return null;
    }

    return crypto.createHash("sha256").update(identifier.toLowerCase()).digest("hex");
}

async function createAuthAuditLog({
    userId = null,
    eventType,
    outcome,
    failureCategory = null,
    identifier = null,
    context,
    client = prisma,
}) {
    if (context.deviceId) {
        await client.device.upsert({
            where: { id: context.deviceId },
            update: {
                ...(userId ? { userId } : {}),
                deviceName: trimValue(context.deviceName || "VSMS staff web", 100),
                lastSeenAt: new Date(),
            },
            create: {
                id: context.deviceId,
                userId,
                deviceName: trimValue(context.deviceName || "VSMS staff web", 100),
                lastSeenAt: new Date(),
            },
        });
    }
    return client.authAuditLog.create({
        data: {
            userId,
            eventType: trimValue(eventType, 50),
            outcome,
            failureCategory: trimValue(failureCategory, 50),
            identifierHash: hashIdentifier(identifier),
            ipAddress: context.ipAddress,
            userAgent: trimValue(context.userAgent, 500),
            requestId: context.requestId,
            deviceId: context.deviceId,
        },
    });
}

async function createAuditLog({
    userId,
    action,
    entityName,
    entityId,
    oldValue = null,
    newValue = null,
    outcome = "SUCCESS",
    context,
    client = prisma,
}) {
    return client.auditLog.create({
        data: {
            userId,
            action: trimValue(action, 100),
            entityName: trimValue(entityName, 50),
            entityId: entityId || uuidv4(),
            outcome,
            requestId: context.requestId,
            deviceId: context.deviceId,
            oldValue: sanitizeMetadata(oldValue),
            newValue: sanitizeMetadata(newValue),
            ipAddress: context.ipAddress,
            deviceName: trimValue(context.deviceName, 100),
        },
    });
}

module.exports = {
    createAuthAuditLog,
    createAuditLog,
    sanitizeMetadata,
};
