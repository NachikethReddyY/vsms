const crypto = require("crypto");
const prisma = require("../../prisma/prismaClient");
const env = require("../../config/env");
const { decrypt, encrypt, encryptionContext } = require("../../utils/crypto/cryptoUtils");
const { renderBrandedQrSvg } = require("../../utils/qr/qrBranding");
const { assertUuid } = require("../../utils/validation/validation");
const { activeQrPassWhere, hashToken, QR_TOKEN_PATTERN } = require("../../utils/crypto/qrToken");
const { assertRegistrationAssignment, assertQrVerifyAccess } = require("../../utils/auth/staff");
const AppError = require("../../errors/AppError");
const { assignRouteOnce } = require("../screening/routeAssignmentService");
const { createAuditLog, createAuditLogBestEffort } = require("../../utils/logging/audit");
const { AUDIT_ACTIONS } = require("../../utils/logging/auditEvents");

function buildQRTargetUrl(token) {
    return `${env.publicAppOrigin}/participant-status/${encodeURIComponent(token)}`;
}

const activeQrWhere = activeQrPassWhere;

const tokenSelector = (token) => ({ tokenHash: hashToken(token) });

const qrTokenContext = (qrId) => encryptionContext("QRCodePass", qrId, "token");

const qrLookupIdentitySelect = {
    registrationId: true,
    queueNumber: true,
    participant: { select: { firstName: true, lastName: true } },
    event: { select: { eventId: true, name: true } },
};

const qrLookupIdentity = (registration) => ({
    registrationId: registration.registrationId,
    queueNumber: registration.queueNumber,
    participant: {
        firstName: registration.participant.firstName,
        lastName: registration.participant.lastName,
    },
    event: {
        eventId: registration.event.eventId,
        name: registration.event.name,
    },
});

const qrLookupRegistrationSelect = {
    ...qrLookupIdentitySelect,
    eventId: true,
    registrationStatus: true,
    checkedIn: true,
};

const qrLookupRegistration = (registration) => ({
    ...qrLookupIdentity(registration),
    eventId: registration.eventId,
    registrationStatus: registration.registrationStatus,
    checkedIn: registration.checkedIn,
});

const manualCheckInRegistrationSelect = {
    registrationId: true,
    eventId: true,
    registrationStatus: true,
    checkedIn: true,
    checkedInAt: true,
    queueNumber: true,
};

const manualCheckInRegistration = (registration) => ({
    registrationId: registration.registrationId,
    eventId: registration.eventId,
    registrationStatus: registration.registrationStatus,
    checkedIn: registration.checkedIn,
    checkedInAt: registration.checkedInAt,
    queueNumber: registration.queueNumber,
});

const decryptQrToken = (qr) => {
    if (qr.tokenEncryptionVersion !== 2 || !qr.tokenCiphertext) {
        throw new AppError(410, "QR_REISSUE_REQUIRED", "This QR pass must be reissued before it can be rendered.");
    }
    try {
        return decrypt(qr.tokenCiphertext, qrTokenContext(qr.id));
    } catch {
        throw new AppError(410, "QR_REISSUE_REQUIRED", "This QR pass must be reissued before it can be rendered.");
    }
};

const safeQrRecord = (qr) => ({
    id: qr.id,
    registrationId: qr.registrationId,
    expiresAt: qr.expiresAt,
    issuedAt: qr.issuedAt,
    isActive: qr.isActive,
    revokedAt: qr.revokedAt,
    revokedBy: qr.revokedBy,
    revokedReason: qr.revokedReason,
});

const lockRegistration = async (tx, registrationId, eventId = null) => {
    if (typeof tx.$queryRaw !== "function") return;
    const rows = eventId
        ? await tx.$queryRaw`
            SELECT registration_id
            FROM event_registrations
            WHERE registration_id = CAST(${registrationId} AS uuid)
              AND event_id = CAST(${eventId} AS uuid)
            FOR UPDATE
        `
        : await tx.$queryRaw`
            SELECT registration_id
            FROM event_registrations
            WHERE registration_id = CAST(${registrationId} AS uuid)
            FOR UPDATE
        `;
    if (Array.isArray(rows) && rows.length === 0) {
        if (eventId) {
            throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration record was not found for this event.");
        }
        throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
    }
};

const lockActiveQrPass = async (tx, qrId, registrationId, now = new Date()) => {
    if (typeof tx.$queryRaw !== "function") {
        return tx.qRCodePass.findFirst({
            where: activeQrWhere({ id: qrId, registrationId }, now),
            select: { id: true, registrationId: true },
        });
    }
    const rows = await tx.$queryRaw`
        SELECT qr_id AS "id", registration_id AS "registrationId"
        FROM qr_code_passes
        WHERE qr_id = CAST(${qrId} AS uuid)
          AND registration_id = CAST(${registrationId} AS uuid)
          AND is_active = true
          AND expires_at > ${now}
        FOR UPDATE
    `;
    return Array.isArray(rows) ? rows[0] || null : null;
};

const renderQr = async (qr, token) => ({
    qrId: qr.id,
    registrationId: qr.registrationId,
    issuedAt: qr.issuedAt,
    expiresAt: qr.expiresAt,
    qrImage: await renderBrandedQrSvg(buildQRTargetUrl(token), { width: 300 }),
});

exports.getEventIdForAccess = async ({ eventId, registrationId, qrId, token }, db = prisma) => {
    let resolvedEventId = null;
    if (registrationId) {
        resolvedEventId = (await db.eventRegistration.findUnique({
            where: { registrationId },
            select: { eventId: true },
        }))?.eventId;
    } else if (qrId || token) {
        resolvedEventId = (await db.qRCodePass.findFirst({
            where: activeQrWhere(qrId ? { id: qrId } : tokenSelector(token)),
            select: { registration: { select: { eventId: true } } },
        }))?.registration?.eventId;
    } else if (eventId) {
        resolvedEventId = eventId;
    }

    if (!resolvedEventId) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration event was not found.");
    if (eventId && resolvedEventId !== eventId) throw new AppError(400, "QR_EVENT_MISMATCH", "QR Code is not valid for this specific event.");
    return resolvedEventId;
};

exports.assertRegistrationAccess = async (selectors, auth, db = prisma) => {
    const eventId = await exports.getEventIdForAccess(selectors, db);
    await assertRegistrationAssignment(db, eventId, auth);
    return eventId;
};

exports.assertVerificationAccess = async (selectors, auth, db = prisma) => {
    const eventId = await exports.getEventIdForAccess(selectors, db);
    await assertQrVerifyAccess(db, eventId, auth);
    return eventId;
};

/**
 * Audit Logger Helper conforming to unified schema
 */
async function writeAudit(tx, {
    userId,
    action,
    entityName,
    entityId,
    newValue,
    requestId,
    deviceId,
    ipAddress,
    deviceName,
}) {
    await createAuditLog({
        userId,
        action,
        resource: entityName,
        entityName,
        entityId,
        newValue,
        context: { requestId, deviceId, ipAddress, deviceName },
        client: tx,
    });
}

// ==========================================
// Generate Registration QR (Compatibility Endpoint)
// ==========================================
exports.generateRegistrationQR = async (registrationId, userId, auditContext = {}) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }
    return await exports.generateQR(registrationId, userId, null, auditContext);
};

// ==========================================
// Get Registration By QR (Compatibility Endpoint)
// ==========================================
exports.getRegistrationByQR = async (token, db = prisma) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

    const qr = await db.qRCodePass.findFirst({
        where: activeQrWhere(tokenSelector(token)),
        select: { registration: { select: qrLookupRegistrationSelect } },
    });

    if (!qr) {
        throw new AppError(404, "NOT_FOUND", "Registration not found for this QR token.");
    }

    return qrLookupRegistration(qr.registration);
};

// ==========================================
// Generate Secure QR Pass
// ==========================================
exports.generateQR = async (registrationId, userId = null, externalTx = null, auditContext = {}) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }

    const execute = async (tx) => {
        // Serialize first issuance on the registration row so concurrent calls
        // converge on one active pass.
        await lockRegistration(tx, registrationId);
        const registration = await tx.eventRegistration.findUnique({
            where: { registrationId },
            include: { participant: true, event: true },
        });

        if (!registration) {
            throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
        }
        if (registration.registrationStatus === "CANCELLED" || registration.event.status === "CANCELLED") {
            throw new AppError(409, "QR_LIFECYCLE_CLOSED", "A QR pass cannot be issued for a cancelled registration or event.");
        }

        const now = new Date();
        const existing = await tx.qRCodePass.findFirst({
            where: activeQrWhere({ registrationId }, now),
            orderBy: { issuedAt: "desc" },
        });
        if (existing) {
            const eventEndsAt = registration.event.endsAt?.getTime() || 0;
            const currentExpiry = existing.expiresAt?.getTime() || 0;
            const stablePass = eventEndsAt > currentExpiry
                ? await tx.qRCodePass.update({ where: { id: existing.id }, data: { expiresAt: registration.event.endsAt } })
                : existing;
            return renderQr(stablePass, decryptQrToken(stablePass));
        }

        const qrId = crypto.randomUUID();
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Math.max(
            now.getTime() + env.qrTtlHours * 60 * 60 * 1000,
            registration.event.endsAt?.getTime() || 0,
        ));

        await tx.qRCodePass.updateMany({
            // Expired rows can still have is_active=true and therefore occupy
            // the database partial-unique slot.
            where: { registrationId, isActive: true },
            data: {
                isActive: false,
                revokedAt: now,
                revokedBy: userId,
                revokedReason: "Superseded by a newly generated QR pass",
            },
        });

        const qrRecord = await tx.qRCodePass.create({
            data: {
                id: qrId,
                registrationId,
                tokenHash: hashToken(token),
                tokenCiphertext: encrypt(token, qrTokenContext(qrId)),
                tokenEncryptionVersion: 2,
                expiresAt,
                isActive: true,
            },
        });

        await writeAudit(tx, {
            userId,
            action: "QR_GENERATED",
            entityName: "QRCodePass",
            entityId: qrRecord.id,
            newValue: { registrationId, expiresAt },
            ...auditContext,
        });

        return renderQr({ ...qrRecord, registrationId }, token);
    };

    return externalTx ? execute(externalTx) : prisma.$transaction(execute);
};

// ==========================================
// Verify QR Pass Token
// ==========================================
exports.verifyQR = async (token, eventId = null, userId = null, db = prisma, auditContext = {}) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

    try {
        return await db.$transaction(async (tx) => {
            const qr = await tx.qRCodePass.findFirst({
                where: activeQrWhere(tokenSelector(token)),
                include: {
                    registration: {
                        include: { participant: true, event: true },
                    },
                },
            });

            if (!qr) throw new AppError(404, "INVALID_QR", "QR Code is invalid, expired, or unavailable.");
            if (eventId && qr.registration.eventId !== eventId) {
                throw new AppError(400, "QR_EVENT_MISMATCH", "QR Code is not valid for this specific event.");
            }

            await writeAudit(tx, {
                userId,
                action: AUDIT_ACTIONS.QR_VERIFIED,
                entityName: "QRCodePass",
                entityId: qr.id,
                newValue: { registrationId: qr.registration.registrationId, eventId: qr.registration.eventId },
                ...auditContext,
            });

            return {
                valid: true,
                qrId: qr.id,
                registrationId: qr.registration.registrationId,
                participant: {
                    id: qr.registration.participant.id,
                    firstName: qr.registration.participant.firstName,
                    lastName: qr.registration.participant.lastName,
                },
                event: {
                    id: qr.registration.event.eventId,
                    name: qr.registration.event.name,
                },
                queueNumber: qr.registration.queueNumber,
            };
        });
    } catch (error) {
        await createAuditLogBestEffort({
            userId,
            action: Number(error?.status || error?.statusCode) >= 500
                ? AUDIT_ACTIONS.QR_VERIFICATION_FAILED
                : AUDIT_ACTIONS.QR_VERIFICATION_DENIED,
            resource: "QRCodePass",
            entityName: "QRCodeVerificationAttempt",
            outcome: Number(error?.status || error?.statusCode) >= 500 ? "FAILED" : "DENIED",
            newValue: {
                eventId,
                errorCode: error?.code || "QR_VERIFICATION_FAILED",
                tokenFingerprint: hashToken(token),
            },
            context: auditContext,
            client: db,
        });
        throw error;
    }
};

// ==========================================
// Public Pass Status (scan target, no PII)
// ==========================================
exports.getPublicStatus = async (token, db = prisma) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

    const qr = await db.qRCodePass.findFirst({
        where: activeQrWhere(tokenSelector(String(token).toLowerCase().trim())),
        select: {
            expiresAt: true,
            registration: {
                select: {
                    queueNumber: true,
                    registrationStatus: true,
                    event: { select: { name: true } },
                    routeSteps: {
                        orderBy: { position: "asc" },
                        select: {
                            position: true,
                            completedAt: true,
                            station: { select: { stationId: true, stationName: true, stationType: true } },
                        },
                    },
                    queueEntries: {
                        where: { status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
                        orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
                        take: 1,
                        select: {
                            status: true,
                            queueNumber: true,
                            station: { select: { stationId: true, stationName: true, stationType: true } },
                        },
                    },
                },
            },
        },
    });

    if (!qr?.registration) {
        return {
            valid: false,
            eventName: null,
            queueNumber: null,
            registrationStatus: null,
            queueState: null,
            route: [],
            expiresAt: null,
        };
    }

    const activeEntry = qr.registration.queueEntries[0] || null;
    const firstUnfinishedPosition = qr.registration.routeSteps.find(({ completedAt }) => !completedAt)?.position;
    const queueState = activeEntry
        ? {
            status: activeEntry.status,
            queueNumber: activeEntry.queueNumber,
            station: {
                name: activeEntry.station.stationName,
                type: activeEntry.station.stationType,
            },
        }
        : null;
    const route = qr.registration.routeSteps.map((step) => ({
        stationName: step.station.stationName,
        stationType: step.station.stationType,
        state: step.completedAt
            ? "COMPLETED"
            : activeEntry?.station.stationId === step.station.stationId
                ? "CURRENT"
                : !activeEntry && step.position === firstUnfinishedPosition
                    ? "BLOCKED"
                    : "UPCOMING",
    }));
    if (route.length) {
        route.push({
            stationName: "Clinical review",
            stationType: "CLINICAL_REVIEW",
            state: qr.registration.registrationStatus === "COMPLETED"
                ? "COMPLETED"
                : firstUnfinishedPosition == null ? "CURRENT" : "UPCOMING",
        });
    }

    return {
        valid: true,
        eventName: qr.registration.event.name,
        queueNumber: qr.registration.queueNumber,
        registrationStatus: qr.registration.registrationStatus,
        queueState,
        route,
        expiresAt: qr.expiresAt,
    };
};

// ==========================================
// Get Active Participant Info by QR Token
// ==========================================
exports.getParticipant = async (token, db = prisma) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

    const qr = await db.qRCodePass.findFirst({
        where: activeQrWhere(tokenSelector(token)),
        select: {
            id: true,
            registrationId: true,
            expiresAt: true,
            isActive: true,
            registration: { select: qrLookupIdentitySelect },
        },
    });

    if (!qr) {
        throw new AppError(404, "PARTICIPANT_NOT_FOUND", "QR Code is invalid, expired, or deactivated.");
    }

    const registration = qrLookupIdentity(qr.registration);
    return {
        qrId: qr.id,
        registrationId: registration.registrationId,
        participant: registration.participant,
        event: registration.event,
        queueNumber: registration.queueNumber,
        expiresAt: qr.expiresAt,
        isActive: qr.isActive,
    };
};

// ==========================================
// Revoke Active QR Code
// ==========================================
exports.revokeQR = async (qrId, revokedReason = "Revoked by staff", revokedBy = null, db = prisma, auditContext = {}) => {
    if (!qrId) {
        throw new AppError(400, "QR_ID_REQUIRED", "QR ID is required.");
    }

    return await db.$transaction(async (tx) => {
        const now = new Date();
        const qr = await tx.qRCodePass.findFirst({
            where: activeQrWhere({ id: qrId }, now),
            select: { id: true, registrationId: true },
        });

        if (!qr) throw new AppError(404, "QR_NOT_FOUND", "QR Code is invalid, expired, or unavailable.");
        await lockRegistration(tx, qr.registrationId);
        if (!await lockActiveQrPass(tx, qr.id, qr.registrationId, now)) {
            throw new AppError(409, "QR_STATE_CONFLICT", "QR Code is no longer active.");
        }

        const updated = await tx.qRCodePass.updateMany({
            where: activeQrWhere({ id: qrId }, now),
            data: {
                isActive: false,
                revokedAt: now,
                revokedBy,
                revokedReason,
            },
        });
        if (updated.count !== 1) throw new AppError(409, "QR_STATE_CONFLICT", "QR Code is no longer active.");
        const updatedQr = await tx.qRCodePass.findUnique({ where: { id: qrId } });

        await writeAudit(tx, {
            userId: revokedBy,
            action: "QR_REVOKED",
            entityName: "QRCodePass",
            entityId: qrId,
            newValue: { reason: revokedReason },
            ...auditContext,
        });

        return safeQrRecord(updatedQr);
    });
};

// ==========================================
// Reissue QR Code
// ==========================================
exports.reissueQR = async (registrationId, userId = null, db = prisma, auditContext = {}) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }

    return await db.$transaction(async (tx) => {
        const now = new Date();
        await lockRegistration(tx, registrationId);
        // 1. Deactivate existing passes
        await tx.qRCodePass.updateMany({
            where: { registrationId, isActive: true },
            data: {
                isActive: false,
                revokedAt: now,
                revokedBy: userId,
                revokedReason: "Reissued new QR code",
            },
        });

        await writeAudit(tx, {
            userId,
            action: "QR_REISSUED_REVOCATION",
            entityName: "EventRegistration",
            entityId: registrationId,
            newValue: { action: "Revoked prior active QRs" },
            ...auditContext,
        });

        // 2. Generate new QR pass within the same active transaction client
        return await exports.generateQR(registrationId, userId, tx, auditContext);
    });
};

// ==========================================
// Download QR Image
// ==========================================
exports.downloadQR = async (qrId, db = prisma) => {
    if (!qrId) {
        throw new AppError(400, "QR_ID_REQUIRED", "QR ID is required.");
    }

    const qr = await db.qRCodePass.findFirst({ where: activeQrWhere({ id: qrId }) });
    if (!qr) throw new AppError(404, "QR_NOT_FOUND", "QR Code is invalid, expired, or unavailable.");

    const qrImage = await renderBrandedQrSvg(buildQRTargetUrl(decryptQrToken(qr)), { width: 600 });

    return { qrId: qr.id, expiresAt: qr.expiresAt, qrImage };
};

/** Re-render the active participant pass for authenticated station tablets. */
exports.renderActivePassForRegistration = async (registrationId, db = prisma) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }

    const registration = await db.eventRegistration.findUnique({
        where: { registrationId },
        select: {
            registrationId: true,
            queueNumber: true,
            participant: { select: { firstName: true, lastName: true } },
        },
    });
    if (!registration) {
        throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration was not found.");
    }

    const displayName = [registration.participant?.firstName, registration.participant?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || "Participant";

    const qr = await db.qRCodePass.findFirst({
        where: activeQrWhere({ registrationId }),
        orderBy: { issuedAt: "desc" },
    });
    if (qr) {
        const rendered = await renderQr(qr, decryptQrToken(qr));
        return {
            ...rendered,
            participantDisplayName: displayName,
            queueNumber: registration.queueNumber,
        };
    }

    throw new AppError(404, "QR_NOT_FOUND", "No active secure QR pass is available for this participant. Reissue the pass before scanning.");
};

exports.getDevPageData = async (registrationId, auditContext = {}, db = prisma) => {
    const registration = await db.eventRegistration.findUnique({
        where: { registrationId },
        include: {
            participant: { select: { firstName: true, lastName: true } },
            event: { select: { name: true } },
        },
    });
    if (!registration) return null;

    const qr = await exports.generateRegistrationQR(registrationId, null, auditContext);
    let scanQr = Buffer.from(qr.qrImage.split(",")[1], "base64").toString("utf8");
    const activePass = await db.qRCodePass.findFirst({
        where: { registrationId, isActive: true },
        orderBy: { issuedAt: "desc" },
    });
    let token = null;
    if (activePass) {
        try {
            token = decrypt(activePass.tokenCiphertext, qrTokenContext(activePass.id));
        } catch { /* token display is best-effort */ }
    }
    if (token) {
        const branded = await renderBrandedQrSvg(buildQRTargetUrl(token), { width: 420 });
        scanQr = Buffer.from(branded.split(",")[1], "base64").toString("utf8");
    }

    return {
        displayName: [registration.participant?.firstName, registration.participant?.lastName].filter(Boolean).join(" ") || "—",
        eventName: registration.event?.name || "Unknown event",
        queueNumber: registration.queueNumber,
        tokenPreview: token ? `${token.slice(0, 12)}…` : null,
        scanQr,
        statusUrl: token ? `/api/v1/qr/public-status/${encodeURIComponent(token)}` : null,
    };
};

// ==========================================
// Print QR Helper
// ==========================================
exports.printQR = async (qrId, db = prisma) => {
    if (!qrId) {
        throw new AppError(400, "QR_ID_REQUIRED", "QR ID is required.");
    }
    return exports.downloadQR(qrId, db);
};

// ==========================================
// Manual Check-In Procedure
// ==========================================
exports.manualCheckIn = async (params, db = prisma, auditContext = {}) => {
    let { registrationId, identifier, eventId, userId, ipAddress, deviceName } =
        typeof params === "object" ? params : { registrationId: params };

    if (ipAddress || deviceName) {
        auditContext = { ...auditContext, ipAddress, deviceName };
    }

    if (!eventId) {
        throw new AppError(400, "EVENT_ID_REQUIRED", "Event ID is required for manual check-in.");
    }
    eventId = assertUuid(eventId, "eventId");

    if (Boolean(registrationId) === Boolean(identifier)) {
        throw new AppError(400, "CHECKIN_REFERENCE_REQUIRED", "Supply exactly one registration reference or QR token.");
    }
    if (registrationId) registrationId = assertUuid(registrationId, "registrationId");
    if (identifier && (typeof identifier !== "string" || !QR_TOKEN_PATTERN.test(identifier))) {
        throw new AppError(400, "INVALID_QR", "QR Code is invalid, expired, or unavailable.");
    }
    if (identifier) identifier = identifier.toLowerCase();

    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            return await db.$transaction(async (tx) => {
        let regIdToUpdate = registrationId;
        let qrIdToUse = null;

        if (!regIdToUpdate && identifier) {
            const qr = await tx.qRCodePass.findFirst({
                where: activeQrWhere({
                    ...tokenSelector(identifier),
                    registration: { eventId },
                }),
                select: {
                    id: true,
                    registrationId: true,
                },
            });

            if (qr) {
                regIdToUpdate = qr.registrationId;
                qrIdToUse = qr.id;
            }
        }

        if (!regIdToUpdate) {
            throw new AppError(404, "INVALID_QR", "QR Code is invalid, expired, or unavailable.");
        }

        await lockRegistration(tx, regIdToUpdate, eventId);
        if (qrIdToUse && !await lockActiveQrPass(tx, qrIdToUse, regIdToUpdate)) {
            throw new AppError(404, "INVALID_QR", "QR Code is invalid, expired, or unavailable.");
        }

        const registration = await tx.eventRegistration.findFirst({
            where: {
                registrationId: regIdToUpdate,
                eventId,
            },
            select: manualCheckInRegistrationSelect,
        });
        if (!registration) {
            throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration record was not found for this event.");
        }
        if (registration.registrationStatus !== "SIGNED_UP" || registration.checkedIn) {
            throw new AppError(409, "CHECKIN_STATE_CONFLICT", "Only a signed-up participant can be checked in.");
        }

        const checkedInAt = new Date();
        const updated = await tx.eventRegistration.updateMany({
            where: {
                registrationId: registration.registrationId,
                eventId,
                registrationStatus: "SIGNED_UP",
                checkedIn: false,
            },
            data: {
                checkedIn: true,
                checkedInAt,
                registrationStatus: "CHECKED_IN",
            },
        });
        if (updated.count !== 1) {
            throw new AppError(409, "CHECKIN_STATE_CONFLICT", "Registration was changed before check-in completed.");
        }

        const result = manualCheckInRegistration({
            ...registration,
            registrationStatus: "CHECKED_IN",
            checkedIn: true,
            checkedInAt,
        });

        const route = await assignRouteOnce({
            tx,
            registrationId: registration.registrationId,
            eventId,
            actorUserId: userId,
            context: auditContext,
        });

        await writeAudit(tx, {
            userId,
            action: "MANUAL_CHECKIN_PERFORMED",
            entityName: "EventRegistration",
            entityId: regIdToUpdate,
            newValue: {
                eventId: result.eventId,
                checkInMethod: identifier ? "QR_TOKEN" : "REGISTRATION_REFERENCE",
            },
            ...auditContext,
        });

                return { ...result, route };
            }, { isolationLevel: "Serializable" });
        } catch (error) {
            if (error.code === "P2034" && attempt < 3) continue;
            throw error;
        }
    }
    throw new AppError(409, "CHECKIN_CONFLICT", "Unable to check in this participant. Please retry.");
};
