const crypto = require("crypto");
const { validate: isUuid } = require("uuid");
const prisma = require("../../prisma/prismaClient");
const referralService = require("../screening/referralService");
const {
    processArtifactCleanupTasks,
    listArtifactCleanupTasks,
    maintainArtifactCleanupTask,
} = require("../platform/artifactCleanupService");
const { encodeCursor, decodeCursor } = require("../../utils/http/cursor");
const { createAuditLog } = require("../../utils/logging/audit");
const { drainDueProviderOperations, maintainProviderOperation } = require("./accountProviderOperationService");

const AUDIT_SOURCES = Object.freeze({
    APPLICATION: "APPLICATION",
    AUTHENTICATION: "AUTHENTICATION",
    EVENT: "EVENT",
});
const EVENT_AUDIT_ACTIONS = new Set(["CREATED", "UPDATED", "PUBLISHED", "STARTED", "COMPLETED", "CANCELLED", "DELETED"]);

const actorSelect = { id: true, fullName: true, email: true, status: true };

const cursorScope = (filters) => {
    const fingerprint = crypto.createHash("sha256")
        .update(JSON.stringify(filters))
        .digest("hex")
        .slice(0, 24);
    return `admin-audit-v2:${fingerprint}`;
};

const cursorWhere = (cursor, source, timestampField, idField) => {
    if (!cursor) return null;
    const timestamp = new Date(cursor.occurredAt);
    const sameTimestamp = source.localeCompare(cursor.source);
    const afterCursor = [{ [timestampField]: { lt: timestamp } }];
    if (sameTimestamp > 0) {
        afterCursor.push({ [timestampField]: timestamp });
    } else if (sameTimestamp === 0) {
        afterCursor.push({ [timestampField]: timestamp, [idField]: { lt: cursor.id } });
    }
    return { OR: afterCursor };
};

const withCursor = (filters, cursor, source, timestampField, idField) => {
    const keyset = cursorWhere(cursor, source, timestampField, idField);
    return keyset ? { AND: [filters, keyset] } : filters;
};

const safeEventId = (...values) => values.find((value) => typeof value === "string" && isUuid(value)) || null;

const applicationEventId = (row) => safeEventId(
    row.entityName === "Event" ? row.entityId : null,
    row.newValue?.eventId,
    row.oldValue?.eventId,
    row.details?.eventId,
);

const normalizeApplication = (row) => ({
    id: row.id,
    source: AUDIT_SOURCES.APPLICATION,
    occurredAt: row.createdAt,
    action: row.action,
    outcome: row.outcome,
    actor: row.user,
    eventId: applicationEventId(row),
    entityName: row.entityName,
    entityId: row.entityId,
    requestId: row.requestId,
    ipAddress: row.ipAddress,
    deviceName: row.deviceName,
    details: row.details,
    oldValue: row.oldValue,
    newValue: row.newValue,
});

const normalizeAuthentication = (row) => ({
    id: row.id,
    source: AUDIT_SOURCES.AUTHENTICATION,
    occurredAt: row.occurredAt,
    action: row.eventType,
    outcome: row.outcome,
    actor: row.user,
    eventId: null,
    entityName: "Authentication",
    entityId: row.userId,
    requestId: row.requestId,
    ipAddress: row.ipAddress,
    deviceName: null,
    userAgent: row.userAgent,
    details: {
        failureCategory: row.failureCategory,
        identifierHash: row.identifierHash,
    },
    oldValue: null,
    newValue: null,
});

const normalizeEvent = (row) => ({
    id: row.eventAuditLogId,
    source: AUDIT_SOURCES.EVENT,
    occurredAt: row.createdAt,
    action: row.action,
    outcome: "SUCCESS",
    actor: row.actor,
    eventId: row.eventId,
    entityName: "Event",
    entityId: row.eventId,
    requestId: row.correlationId,
    ipAddress: null,
    deviceName: null,
    details: null,
    oldValue: row.beforeSnapshot,
    newValue: row.afterSnapshot,
});

const chronological = (left, right) => {
    const timestampDifference = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
    if (timestampDifference !== 0) return timestampDifference;
    const sourceDifference = left.source.localeCompare(right.source);
    return sourceDifference !== 0 ? sourceDifference : right.id.localeCompare(left.id);
};

const validCursor = (cursor) => cursor
    && Object.values(AUDIT_SOURCES).includes(cursor.source)
    && isUuid(cursor.id)
    && Number.isFinite(new Date(cursor.occurredAt).getTime());

/**
 * Reads all immutable audit ledgers through one globally ordered keyset.
 */
exports.getAuditLogs = async ({ cursor, limit, entityName, action, eventType, outcome, from, to }) => {
    const scopeFilters = {
        entityName: entityName || null,
        action: action || null,
        eventType: eventType || null,
        outcome: outcome || null,
        from: from?.toISOString() || null,
        to: to?.toISOString() || null,
    };
    const scope = cursorScope(scopeFilters);
    const decodedCursor = decodeCursor(cursor ?? null, scope);
    if (decodedCursor && !validCursor(decodedCursor)) {
        const AppError = require("../../errors/AppError");
        throw new AppError(422, "INVALID_CURSOR", "Pagination cursor is invalid");
    }

    const applicationFilters = {
        ...(entityName ? { entityName } : {}),
        ...(action ? { action } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const authenticationFilters = {
        ...(eventType || action ? { eventType: eventType || action } : {}),
        ...(outcome ? { outcome } : {}),
        ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const eventFilters = {
        ...(action && EVENT_AUDIT_ACTIONS.has(action) ? { action } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const includeApplication = !eventType;
    const includeAuthentication = !entityName && (!eventType || !action || eventType === action);
    const includeEvents = !eventType
        && (!entityName || entityName === "Event")
        && (!outcome || outcome === "SUCCESS")
        && (!action || EVENT_AUDIT_ACTIONS.has(action));

    const [logs, authLogs, eventLogs] = await Promise.all([
        includeApplication
            ? prisma.auditLog.findMany({
                where: withCursor(applicationFilters, decodedCursor, AUDIT_SOURCES.APPLICATION, "createdAt", "id"),
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: limit + 1,
                include: { user: { select: actorSelect } },
            })
            : [],
        includeAuthentication
            ? prisma.authAuditLog.findMany({
                where: withCursor(authenticationFilters, decodedCursor, AUDIT_SOURCES.AUTHENTICATION, "occurredAt", "id"),
                orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
                take: limit + 1,
                include: { user: { select: actorSelect } },
            })
            : [],
        includeEvents
            ? prisma.eventAuditLog.findMany({
                where: withCursor(eventFilters, decodedCursor, AUDIT_SOURCES.EVENT, "createdAt", "eventAuditLogId"),
                orderBy: [{ createdAt: "desc" }, { eventAuditLogId: "desc" }],
                take: limit + 1,
                include: { actor: { select: actorSelect } },
            })
            : [],
    ]);

    const merged = [
        ...logs.map(normalizeApplication),
        ...authLogs.map(normalizeAuthentication),
        ...eventLogs.map(normalizeEvent),
    ].sort(chronological);
    const hasMore = merged.length > limit;
    const items = merged.slice(0, limit);
    const last = items.at(-1);

    return {
        items,
        nextCursor: hasMore && last
            ? encodeCursor({ scope, occurredAt: new Date(last.occurredAt).toISOString(), source: last.source, id: last.id })
            : null,
    };
};

/**
 * Executes referral delivery maintenance and triggers artifact cleanup
 */
exports.runReferralDeliveryMaintenance = async (body, actor, ipAddress) => ({
    deliveries: await referralService.reconcileReferralDeliveries(body, actor, ipAddress),
    artifactCleanup: await processArtifactCleanupTasks({ limit: 200 }),
});

exports.listArtifactCleanupTasks = (query, actor) => listArtifactCleanupTasks(query, actor);

exports.maintainArtifactCleanupTask = (taskId, body, actor, ipAddress) => (
    maintainArtifactCleanupTask(taskId, body, actor, ipAddress)
);

/**
 * Drains due provider queue operations and generates audit trail
 */
exports.drainAccountProviderOperations = async (body, actorId, context) => {
    const summary = await drainDueProviderOperations(body);
    await createAuditLog({
        userId: actorId,
        action: "ACCOUNT_PROVIDER_OPERATIONS_DRAINED",
        entityName: "User",
        entityId: actorId,
        newValue: {
            attempted: summary.attempted,
            succeeded: summary.succeeded,
            failed: summary.failed,
            pending: summary.pending,
            escalated: summary.escalated,
        },
        context,
    });
    return summary;
};

exports.maintainAccountProviderOperation = (operationId, action, reason, actorId, context) => (
    maintainProviderOperation(operationId, action, reason, actorId, context)
);
