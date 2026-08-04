const crypto = require("crypto");
const { v4: uuidv4, validate: isUuid } = require("uuid");
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

async function resolveAuditContext({ userId, context, client = prisma }) {
    const requestedDeviceId = typeof context === "object" ? context?.deviceId : null;
    const device = requestedDeviceId && isUuid(requestedDeviceId) && userId ? await client.device.findFirst({
        where: { id: requestedDeviceId, userId, status: "ACTIVE" },
        select: { id: true },
    }) : null;
    return {
        requestId: typeof context === "string" ? context : context?.requestId || null,
        deviceId: device?.id || null,
        ipAddress: typeof context === "object" ? trimValue(context?.ipAddress, 45) : null,
        deviceName: typeof context === "object" ? trimValue(context?.deviceName, 100) : null,
    };
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
    const auditContext = await resolveAuditContext({ userId, context, client });
    return client.authAuditLog.create({
        data: {
            userId,
            eventType: trimValue(eventType, 50),
            outcome,
            failureCategory: trimValue(failureCategory, 50),
            identifierHash: hashIdentifier(identifier),
            ipAddress: auditContext.ipAddress,
            userAgent: trimValue(context?.userAgent, 500),
            requestId: auditContext.requestId,
            deviceId: auditContext.deviceId,
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
    const auditContext = await resolveAuditContext({ userId, context, client });
    return client.auditLog.create({
        data: {
            userId,
            action: trimValue(action, 100),
            entityName: trimValue(entityName, 50),
            entityId: entityId || uuidv4(),
            outcome,
            requestId: auditContext.requestId,
            deviceId: auditContext.deviceId,
            oldValue: sanitizeMetadata(oldValue),
            newValue: sanitizeMetadata(newValue),
            ipAddress: auditContext.ipAddress,
            deviceName: auditContext.deviceName,
        },
    });
}

module.exports = {
    createAuthAuditLog,
    createAuditLog,
    resolveAuditContext,
    sanitizeMetadata,
};
