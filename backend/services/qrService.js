const QRCode = require("qrcode");
const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const env = require("../config/env");
const { decrypt, encrypt, encryptionContext } = require("../utils/cryptoUtils");
const AppError = require("../errors/AppError");

function buildQRTargetUrl(token) {
    return `${env.publicAppOrigin}/participant-status/${encodeURIComponent(token)}`;
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

const activeQrWhere = (selector = {}, now = new Date()) => ({
    ...selector,
    isActive: true,
    expiresAt: { gt: now },
});

const tokenSelector = (token) => ({ tokenHash: hashToken(token) });

const qrTokenContext = (qrId) => encryptionContext("QRCodePass", qrId, "token");

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

const lockRegistrationForQrIssuance = async (tx, registrationId) => {
    if (typeof tx.$queryRaw !== "function") return;
    const rows = await tx.$queryRaw`
        SELECT registration_id
        FROM event_registrations
        WHERE registration_id = CAST(${registrationId} AS uuid)
        FOR UPDATE
    `;
    if (Array.isArray(rows) && rows.length === 0) {
        throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
    }
};

const renderQr = async (qr, token) => ({
    qrId: qr.id,
    registrationId: qr.registrationId,
    issuedAt: qr.issuedAt,
    expiresAt: qr.expiresAt,
    qrImage: await QRCode.toDataURL(buildQRTargetUrl(token), {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 300,
    }),
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

/**
 * Audit Logger Helper conforming to unified schema
 */
async function writeAudit(tx, { userId, action, entityName, entityId, newValue }) {
    await tx.auditLog.create({
        data: {
            userId: userId || null,
            action,
            entityName,
            entityId: entityId || null,
            newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
            ipAddress: "127.0.0.1",
            deviceName: "Internal System / QR Service",
        },
    });
}

// ==========================================
// Generate Registration QR (Compatibility Endpoint)
// ==========================================
exports.generateRegistrationQR = async (registrationId, userId) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }
    return await exports.generateQR(registrationId, userId);
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
        include: {
            registration: {
                include: { participant: true, event: true },
            },
        },
    });

    if (!qr) {
        throw new AppError(404, "NOT_FOUND", "Registration not found for this QR token.");
    }

    return qr.registration;
};

// ==========================================
// Generate Secure QR Pass
// ==========================================
exports.generateQR = async (registrationId, userId = null, externalTx = null) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }

    const execute = async (tx) => {
        // Serialize first issuance on the registration row so concurrent calls
        // converge on one active pass.
        await lockRegistrationForQrIssuance(tx, registrationId);
        const registration = await tx.eventRegistration.findUnique({
            where: { registrationId },
            include: { participant: true, event: true },
        });

        if (!registration) {
            throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
        }

        const now = new Date();
        const existing = await tx.qRCodePass.findFirst({
            where: activeQrWhere({ registrationId }, now),
            orderBy: { issuedAt: "desc" },
        });
        if (existing) return renderQr(existing, decryptQrToken(existing));

        const qrId = crypto.randomUUID();
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours

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
        });

        return renderQr({ ...qrRecord, registrationId }, token);
    };

    return externalTx ? execute(externalTx) : prisma.$transaction(execute);
};

// ==========================================
// Verify QR Pass Token
// ==========================================
exports.verifyQR = async (token, eventId = null, userId = null, db = prisma) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

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
            action: "QR_VERIFIED",
            entityName: "QRCodePass",
            entityId: qr.id,
            newValue: { registrationId: qr.registration.registrationId, eventId },
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
        include: {
            registration: {
                include: { participant: true, event: true },
            },
        },
    });

    if (!qr) {
        throw new AppError(404, "PARTICIPANT_NOT_FOUND", "QR Code is invalid, expired, or deactivated.");
    }

    return {
        qrId: qr.id,
        registrationId: qr.registration.registrationId,
        participant: qr.registration.participant,
        event: qr.registration.event,
        queueNumber: qr.registration.queueNumber,
        expiresAt: qr.expiresAt,
        isActive: qr.isActive,
    };
};

// ==========================================
// Revoke Active QR Code
// ==========================================
exports.revokeQR = async (qrId, revokedReason = "Revoked by staff", revokedBy = null, db = prisma) => {
    if (!qrId) {
        throw new AppError(400, "QR_ID_REQUIRED", "QR ID is required.");
    }

    return await db.$transaction(async (tx) => {
        const now = new Date();
        const qr = await tx.qRCodePass.findFirst({ where: activeQrWhere({ id: qrId }, now) });

        if (!qr) throw new AppError(404, "QR_NOT_FOUND", "QR Code is invalid, expired, or unavailable.");

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
        });

        return safeQrRecord(updatedQr);
    });
};

// ==========================================
// Reissue QR Code
// ==========================================
exports.reissueQR = async (registrationId, userId = null, db = prisma) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }

    return await db.$transaction(async (tx) => {
        const now = new Date();
        await lockRegistrationForQrIssuance(tx, registrationId);
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
        });

        // 2. Generate new QR pass within the same active transaction client
        return await exports.generateQR(registrationId, userId, tx);
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

    const qrImage = await QRCode.toDataURL(buildQRTargetUrl(decryptQrToken(qr)), {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 600,
    });

    return { qrId: qr.id, expiresAt: qr.expiresAt, qrImage };
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
exports.manualCheckIn = async (params, db = prisma) => {
    const { registrationId, identifier, eventId, userId } =
        typeof params === "object" ? params : { registrationId: params };

    if (!registrationId && !identifier) {
        throw new AppError(400, "IDENTIFIER_REQUIRED", "Registration ID or Identifier is required.");
    }

    return await db.$transaction(async (tx) => {
        let regIdToUpdate = registrationId;

        if (!regIdToUpdate && identifier) {
            // Step A: Search by QR Token
            const qr = await tx.qRCodePass.findFirst({
                where: activeQrWhere(tokenSelector(identifier)),
                select: {
                    registrationId: true,
                    registration: { select: { eventId: true } },
                },
            });

            if (qr) {
                if (eventId && qr.registration.eventId !== eventId) {
                    throw new AppError(400, "QR_EVENT_MISMATCH", "QR Code is not valid for this specific event.");
                }
                regIdToUpdate = qr.registrationId;
            } else {
                // Step B: Search by Encrypted NRIC
                const encryptedIdentifier = encrypt(identifier, encryptionContext("ManualCheckIn", eventId || "unscoped", "identifier"));
                const participant = await tx.participant.findFirst({
                    where: { nric: encryptedIdentifier },
                });

                if (participant) {
                    const registration = await tx.eventRegistration.findFirst({
                        where: {
                            participantId: participant.id,
                            ...(eventId ? { eventId } : {}),
                        },
                    });
                    if (registration) regIdToUpdate = registration.registrationId;
                }
            }
        }

        if (!regIdToUpdate) {
            throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration record not found for manual check-in.");
        }

        const registration = await tx.eventRegistration.findFirst({
            where: {
                registrationId: regIdToUpdate,
                ...(eventId ? { eventId } : {}),
            },
            select: { registrationId: true },
        });
        if (!registration) {
            throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration record was not found for this event.");
        }

        const updatedRegistration = await tx.eventRegistration.update({
            where: { registrationId: registration.registrationId },
            data: {
                checkedIn: true,
                checkedInAt: new Date(),
                registrationStatus: "CHECKED_IN",
            },
            include: { participant: true, event: true },
        });

        await writeAudit(tx, {
            userId,
            action: "MANUAL_CHECKIN_PERFORMED",
            entityName: "EventRegistration",
            entityId: regIdToUpdate,
            newValue: {
                identifierUsed: identifier || "REGISTRATION_ID",
                eventId: updatedRegistration.eventId,
            },
        });

        return updatedRegistration;
    });
};
