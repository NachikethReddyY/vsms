const QRCode = require("qrcode");
const crypto = require("crypto");
const os = require("os");
const prisma = require("../prisma/prismaClient");
const { encrypt } = require("../utils/cryptoUtils");
const AppError = require("../errors/AppError");

/**
 * Helper: Detects local IPv4 for local network testing.
 */
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === "IPv4" && !net.internal) {
                return net.address;
            }
        }
    }
    return "localhost";
}

/**
 * Helper: Constructs target URL encoded inside QR image.
 */
function buildQRTargetUrl(token) {
    const hostIp = getLocalIpAddress();
    const frontendPort = process.env.FRONTEND_PORT || 3000;
    return `http://${hostIp}:${frontendPort}/participant-status/${token}`;
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

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
exports.getRegistrationByQR = async (token) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

    const qr = await prisma.qRCodePass.findFirst({
        where: {
            OR: [
                { token },
                { tokenHash: hashToken(token) },
            ],
        },
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
        const registration = await tx.eventRegistration.findUnique({
            where: { registrationId },
            include: { participant: true, event: true },
        });

        if (!registration) {
            throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours

        const qrRecord = await tx.qRCodePass.create({
            data: {
                registrationId,
                token,
                tokenHash: hashToken(token),
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

        const targetUrl = buildQRTargetUrl(token);
        const qrImage = await QRCode.toDataURL(targetUrl, {
            errorCorrectionLevel: "H",
            margin: 2,
            width: 300,
        });

        return {
            qrId: qrRecord.id,
            registrationId,
            token,
            targetUrl,
            issuedAt: qrRecord.issuedAt,
            expiresAt: qrRecord.expiresAt,
            qrImage,
        };
    };

    return externalTx ? execute(externalTx) : prisma.$transaction(execute);
};

// ==========================================
// Verify QR Pass Token
// ==========================================
exports.verifyQR = async (token, eventId = null, userId = null) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

    return await prisma.$transaction(async (tx) => {
        const qr = await tx.qRCodePass.findFirst({
            where: {
                OR: [
                    { token },
                    { tokenHash: hashToken(token) },
                ],
            },
            include: {
                registration: {
                    include: { participant: true, event: true },
                },
            },
        });

        if (!qr) throw new AppError(404, "INVALID_QR", "QR Code is invalid or does not exist.");
        if (!qr.isActive) throw new AppError(400, "QR_REVOKED", "QR Code has been revoked.");
        if (new Date() > qr.expiresAt) throw new AppError(400, "QR_EXPIRED", "QR Code has expired.");
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
exports.getParticipant = async (token) => {
    if (!token) {
        throw new AppError(400, "TOKEN_REQUIRED", "QR Token is required.");
    }

    const qr = await prisma.qRCodePass.findFirst({
        where: {
            OR: [
                { token },
                { tokenHash: hashToken(token) },
            ],
            isActive: true,
            expiresAt: { gt: new Date() },
        },
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
exports.revokeQR = async (qrId, revokedReason = "Revoked by staff", revokedBy = null) => {
    if (!qrId) {
        throw new AppError(400, "QR_ID_REQUIRED", "QR ID is required.");
    }

    return await prisma.$transaction(async (tx) => {
        const qr = await tx.qRCodePass.findUnique({ where: { id: qrId } });

        if (!qr) throw new AppError(404, "QR_NOT_FOUND", "QR Code not found.");
        if (!qr.isActive) throw new AppError(400, "QR_ALREADY_REVOKED", "QR Code is already revoked.");

        const updatedQr = await tx.qRCodePass.update({
            where: { id: qrId },
            data: {
                isActive: false,
                revokedAt: new Date(),
                revokedBy,
                revokedReason,
            },
        });

        await writeAudit(tx, {
            userId: revokedBy,
            action: "QR_REVOKED",
            entityName: "QRCodePass",
            entityId: qrId,
            newValue: { reason: revokedReason },
        });

        return updatedQr;
    });
};

// ==========================================
// Reissue QR Code
// ==========================================
exports.reissueQR = async (registrationId, userId = null) => {
    if (!registrationId) {
        throw new AppError(400, "REGISTRATION_ID_REQUIRED", "Registration ID is required.");
    }

    return await prisma.$transaction(async (tx) => {
        // 1. Deactivate existing passes
        await tx.qRCodePass.updateMany({
            where: { registrationId, isActive: true },
            data: {
                isActive: false,
                revokedAt: new Date(),
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
exports.downloadQR = async (qrId) => {
    if (!qrId) {
        throw new AppError(400, "QR_ID_REQUIRED", "QR ID is required.");
    }

    const qr = await prisma.qRCodePass.findUnique({ where: { id: qrId } });
    if (!qr) throw new AppError(404, "QR_NOT_FOUND", "QR Code not found.");

    const targetUrl = buildQRTargetUrl(qr.token);
    const qrImage = await QRCode.toDataURL(targetUrl, {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 600,
    });

    return { qrId: qr.id, targetUrl, qrImage };
};

// ==========================================
// Print QR Helper
// ==========================================
exports.printQR = async (qrId) => {
    if (!qrId) {
        throw new AppError(400, "QR_ID_REQUIRED", "QR ID is required.");
    }
    return await exports.downloadQR(qrId);
};

// ==========================================
// Get All Passes for a Participant
// ==========================================
exports.getParticipantQRCodes = async (participantId) => {
    if (!participantId) {
        throw new AppError(400, "PARTICIPANT_ID_REQUIRED", "Participant ID is required.");
    }

    return await prisma.qRCodePass.findMany({
        where: { registration: { participantId } },
        orderBy: { issuedAt: "desc" },
        include: { registration: { include: { event: true } } },
    });
};

// ==========================================
// Manual Check-In Procedure
// ==========================================
exports.manualCheckIn = async (params) => {
    const { registrationId, identifier, eventId, userId } =
        typeof params === "object" ? params : { registrationId: params };

    if (!registrationId && !identifier) {
        throw new AppError(400, "IDENTIFIER_REQUIRED", "Registration ID or Identifier is required.");
    }

    return await prisma.$transaction(async (tx) => {
        let regIdToUpdate = registrationId;

        if (!regIdToUpdate && identifier) {
            // Step A: Search by QR Token
            const qr = await tx.qRCodePass.findFirst({
                where: { token: identifier },
            });

            if (qr) {
                regIdToUpdate = qr.registrationId;
            } else {
                // Step B: Search by Encrypted NRIC
                const encryptedIdentifier = encrypt(identifier);
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

        const updatedRegistration = await tx.eventRegistration.update({
            where: { registrationId: regIdToUpdate },
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