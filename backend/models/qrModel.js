const QRCode = require("qrcode");
const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");

/**
 * Generate a secure QR Code for a participant.
 *
 * Flow:
 * 1. Generate cryptographically secure token
 * 2. Store token in database
 * 3. Generate QR containing only the token
 * 4. Return QR image
 */

async function generateQR(participantId) {
    const participant = await prisma.legacyParticipant.findUnique({ where: { participantId } });
    if (!participant) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found");

    const registration = await prisma.legacyEventRegistration.findFirst({
        where: { participantId },
        orderBy: { registrationId: "desc" },
    });
    if (!registration) throw new AppError(422, "REGISTRATION_REQUIRED", "Participant has no event registration");

    // Generate 256-bit random token
    const token = crypto.randomBytes(32).toString("hex");

    // Expiry time (24 hours)
    const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000
    );

    await prisma.legacyQrCodePass.create({
        data: {
            registrationId: registration.registrationId,
            token,
            expiresAt,
            isActive: true,
        }
    });

    // Only token is embedded in QR
    const qrPayload = {
        token
    };

    const qrImage = await QRCode.toDataURL(
        JSON.stringify(qrPayload),
        {
            errorCorrectionLevel: "H",
            margin: 2,
            width: 300
        }
    );

    return {
        success: true,

        token,

        expiresAt,

        qrImage
    };
}

async function getParticipant(token) {
    const pass = await prisma.legacyQrCodePass.findFirst({
        where: { token, isActive: true, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!pass) throw new AppError(404, "QR_PASS_NOT_FOUND", "QR pass is invalid or expired");

    const registration = await prisma.legacyEventRegistration.findUnique({
        where: { registrationId: pass.registrationId },
    });
    if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration was not found");

    const participant = await prisma.legacyParticipant.findUnique({
        where: { participantId: registration.participantId },
    });
    if (!participant) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found");
    return participant;
}

module.exports = {
    generateQR,
    getParticipant,
};