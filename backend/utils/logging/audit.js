const crypto = require("crypto");
const { validate: isUuid } = require("uuid");
const prisma = require("../../prisma/prismaClient");
const { sanitizeMetadata } = require("../security/sanitize");
const logger = require("./logger/logger");
const { AUTH_AUDIT_EVENT_VALUES } = require("./auditEvents");

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

async function resolveAuditContext({ userId, context, client = prisma, enrollDevice = false }) {
    const requestedDeviceId = typeof context === "object" ? context?.deviceId : null;
    let device = null;
    if (requestedDeviceId && isUuid(requestedDeviceId) && userId) {
        if (enrollDevice) {
            const select = { id: true, userId: true, status: true };
            device = await client.device.findUnique({ where: { id: requestedDeviceId }, select });
            if (!device) {
                try {
                    device = await client.device.create({
                        data: {
                            id: requestedDeviceId,
                            userId,
                            deviceName: trimValue(context?.deviceName || "VSMS staff web", 100),
                            lastSeenAt: new Date(),
                        },
                        select,
                    });
                } catch (error) {
                    if (error?.code !== "P2002") throw error;
                    device = await client.device.findUnique({ where: { id: requestedDeviceId }, select });
                }
            }
            if (device?.userId !== userId || device?.status !== "ACTIVE") device = null;
        } else {
            device = await client.device.findFirst({
                where: { id: requestedDeviceId, userId, status: "ACTIVE" },
                select: { id: true },
            });
        }
    }
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
    if (!AUTH_AUDIT_EVENT_VALUES.has(eventType)) {
        throw new TypeError(`Unsupported authentication audit event: ${eventType}`);
    }
    const auditContext = await resolveAuditContext({
        userId,
        context,
        client,
        enrollDevice: eventType === "LOGIN_SUCCESS" && outcome === "SUCCESS",
    });
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
    userId = null,
    action,
    resource = null,
    entityName,
    entityId = null,
    details = null,
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
            resource: trimValue(resource, 100),
            entityName: trimValue(entityName, 50),
            entityId,
            outcome,
            requestId: auditContext.requestId,
            deviceId: auditContext.deviceId,
            details: sanitizeMetadata(details),
            oldValue: sanitizeMetadata(oldValue),
            newValue: sanitizeMetadata(newValue),
            ipAddress: auditContext.ipAddress,
            deviceName: auditContext.deviceName,
        },
    });
}

async function createAuditLogBestEffort(entry) {
    try {
        return await createAuditLog(entry);
    } catch (error) {
        logger.error({
            event: "security.audit.write_failed",
            auditAction: entry.action,
            requestId: entry.context?.requestId || null,
            errorCode: error?.code || error?.name || "AUDIT_WRITE_FAILED",
        }, "security.audit.write_failed");
        return null;
    }
}

async function createAuthAuditLogBestEffort(entry) {
    try {
        return await createAuthAuditLog(entry);
    } catch (error) {
        logger.error({
            event: "security.auth_audit.write_failed",
            auditEventType: entry.eventType,
            requestId: entry.context?.requestId || null,
            errorCode: error?.code || error?.name || "AUTH_AUDIT_WRITE_FAILED",
        }, "security.auth_audit.write_failed");
        return null;
    }
}

module.exports = {
    createAuthAuditLog,
    createAuthAuditLogBestEffort,
    createAuditLog,
    createAuditLogBestEffort,
    resolveAuditContext,
    sanitizeMetadata,
};
