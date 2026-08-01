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

const eventVisibility = (user) => user.systemRole === "ADMIN" ? {} : user.systemRole === "EVENT_MANAGER" ? {
    OR: [
        { createdByUserId: user.userId },
        { shifts: { some: { staffAssignments: { some: { userId: user.userId, status: { in: ["ASSIGNED", "CONFIRMED"] } } } } } },
    ],
} : { shifts: { some: { staffAssignments: { some: { userId: user.userId, status: { in: ["ASSIGNED", "CONFIRMED"] } } } } } };

async function requireEventAccess(eventId, user) {
    const event = await prisma.event.findFirst({ where: { eventId, ...eventVisibility(user) }, select: { eventId: true } });
    if (!event) throw new AppError(404, "QR_RECORD_NOT_FOUND", "QR record was not found");
}

async function generateQR(participantId, user) {

    const registration = await prisma.legacyEventRegistration.findFirst({
        where: { participantId },
        orderBy: { registrationId: "desc" },
    });
    if (!registration) throw new AppError(404, "QR_RECORD_NOT_FOUND", "QR record was not found");
    await requireEventAccess(registration.eventId, user);

    const participant = await prisma.legacyParticipant.findUnique({ where: { participantId } });
    if (!participant) throw new AppError(404, "QR_RECORD_NOT_FOUND", "QR record was not found");

    // Generate 256-bit random token
    const token = crypto.randomBytes(32).toString("hex");

    // Expiry time (24 hours)
    const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000
    );

    const qrImage = await QRCode.toDataURL(
        JSON.stringify({ token }),
        {
            errorCorrectionLevel: "H",
            margin: 2,
            width: 300
        }
    );

    await prisma.$transaction(async (tx) => {
        await tx.legacyQrCodePass.updateMany({
            where: { registrationId: registration.registrationId, isActive: true, revokedAt: null },
            data: { isActive: false, revokedAt: new Date(), revokedBy: user.userId, revokedReason: "Replaced by a new pass" },
        });
        await tx.legacyQrCodePass.create({ data: { registrationId: registration.registrationId, token, expiresAt, isActive: true } });
    });

    return {
        success: true,

        expiresAt,

        qrImage
    };
}

async function getParticipant(token, user) {
    const pass = await prisma.legacyQrCodePass.findFirst({
        where: { token, isActive: true, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!pass) throw new AppError(404, "QR_PASS_NOT_FOUND", "QR pass is invalid or expired");

    const registration = await prisma.legacyEventRegistration.findUnique({
        where: { registrationId: pass.registrationId },
    });
    if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration was not found");
    await requireEventAccess(registration.eventId, user);

    const participant = await prisma.legacyParticipant.findUnique({
        where: { participantId: registration.participantId },
    });
    if (!participant) throw new AppError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found");
    return { participantId: participant.participantId, firstName: participant.firstName, lastName: participant.lastName };
}

module.exports = {
    generateQR,
    getParticipant,
};
