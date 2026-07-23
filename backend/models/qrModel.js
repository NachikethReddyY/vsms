const QRCode = require("qrcode");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * ==========================================
 * Generate Secure QR Code
 * ==========================================
 */

async function generateQR(registrationId) {

    // Check registration exists
    const registration = await prisma.eventRegistration.findUnique({
        where: {
            id: registrationId
        },
        include: {
            participant: true,
            event: true
        }
    });

    if (!registration) {
        throw new Error("Event registration not found.");
    }

    // Generate cryptographically secure token
    const token = crypto.randomBytes(32).toString("hex");

    // Expiry time (24 hours)
    const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000
    );

    // Save QR record
    const qrRecord = await prisma.qRCodePass.create({
        data: {
            registrationId,
            token,
            expiresAt,
            isActive: true
        }
    });

    // QR contains ONLY the token
    const qrImage = await QRCode.toDataURL(
        JSON.stringify({ token }),
        {
            errorCorrectionLevel: "H",
            margin: 2,
            width: 300
        }
    );

    return {
        qrId: qrRecord.id,
        registrationId,
        token,
        issuedAt: qrRecord.issuedAt,
        expiresAt: qrRecord.expiresAt,
        qrImage
    };
}

/**
 * ==========================================
 * Verify QR Token
 * ==========================================
 */

async function verifyQR(token) {

    const qr = await prisma.qRCodePass.findFirst({
        where: { token },
        include: {
            registration: {
                include: {
                    participant: true,
                    event: true
                }
            }
        }
    });

    if (!qr) {
        throw new Error("QR Code not found.");
    }

    if (!qr.isActive) {
        throw new Error("QR Code revoked.");
    }

    if (new Date() > qr.expiresAt) {
        throw new Error("QR Code expired.");
    }

    return {
        valid: true,
        qrId: qr.id,
        registrationId: qr.registration.id,
        participant: {
            id: qr.registration.participant.id,
            firstName: qr.registration.participant.firstName,
            lastName: qr.registration.participant.lastName
        },
        event: {
            id: qr.registration.event.id,
            name: qr.registration.event.eventName
        },
        queueNumber: qr.registration.queueNumber
    };
}

/**
 * ==========================================
 * Get Participant By QR Token
 * ==========================================
 */

async function getParticipant(token) {

    const qr = await prisma.qRCodePass.findFirst({
        where: { token },
        include: {
            registration: {
                include: {
                    participant: true,
                    event: true
                }
            }
        }
    });

    if (!qr) {
        throw new Error("QR Code not found.");
    }

    return {
        qrId: qr.id,
        registrationId: qr.registration.id,
        participant: qr.registration.participant,
        event: qr.registration.event,
        queueNumber: qr.registration.queueNumber,
        expiresAt: qr.expiresAt,
        isActive: qr.isActive
    };
}

/**
 * ==========================================
 * Revoke QR Code
 * ==========================================
 */

async function revokeQR(qrId, revokedReason, revokedBy) {

    const qr = await prisma.qRCodePass.findUnique({
        where: { id: qrId }
    });

    if (!qr) {
        throw new Error("QR Code not found.");
    }

    if (!qr.isActive) {
        throw new Error("QR Code already revoked.");
    }

    return await prisma.qRCodePass.update({
        where: { id: qrId },
        data: {
            isActive: false,
            revokedAt: new Date(),
            revokedBy,
            revokedReason
        }
    });
}

/**
 * ==========================================
 * Reissue QR Code
 * ==========================================
 */

async function reissueQR(registrationId) {

    // Deactivate existing active QR codes
    await prisma.qRCodePass.updateMany({
        where: {
            registrationId,
            isActive: true
        },
        data: {
            isActive: false,
            revokedAt: new Date(),
            revokedReason: "Reissued"
        }
    });

    // Generate new QR
    return await generateQR(registrationId);
}

/**
 * ==========================================
 * Download QR Code
 * ==========================================
 */

async function downloadQR(qrId) {

    const qr = await prisma.qRCodePass.findUnique({
        where: { id: qrId }
    });

    if (!qr) {
        throw new Error("QR Code not found.");
    }

    const qrImage = await QRCode.toDataURL(
        JSON.stringify({ token: qr.token }),
        {
            errorCorrectionLevel: "H",
            margin: 2,
            width: 600
        }
    );

    return {
        qrId: qr.id,
        qrImage
    };
}

/**
 * ==========================================
 * Print QR Code
 * ==========================================
 */

async function printQR(qrId) {

    return await downloadQR(qrId);
}

/**
 * ==========================================
 * Get All QR Codes For Participant
 * ==========================================
 */

async function getParticipantQRCodes(participantId) {

    return await prisma.qRCodePass.findMany({
        where: {
            registration: {
                participantId
            }
        },
        orderBy: {
            issuedAt: "desc"
        },
        include: {
            registration: {
                include: {
                    event: true
                }
            }
        }
    });
}

/**
 * ==========================================
 * Manual Check-In
 * ==========================================
 */

async function manualCheckIn(registrationId) {

    const registration =
        await prisma.eventRegistration.findUnique({
            where: { id: registrationId }
        });

    if (!registration) {
        throw new Error("Registration not found.");
    }

    return await prisma.eventRegistration.update({
        where: { id: registrationId },
        data: {
            checkedIn: true,
            checkedInAt: new Date(),
            registrationStatus: "CHECKED_IN"
        }
    });
}

module.exports = {
    generateQR,
    verifyQR,
    getParticipant,
    revokeQR,
    reissueQR,
    downloadQR,
    printQR,
    getParticipantQRCodes,
    manualCheckIn
};