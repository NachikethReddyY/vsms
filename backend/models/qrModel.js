const QRCode = require("qrcode");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

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

    // Ensure participant exists
    const participant = await prisma.participant.findUnique({
        where: {
            id: participantId
        }
    });

    if (!participant) {
        throw new Error("Participant not found.");
    }

    // Generate 256-bit random token
    const token = crypto.randomBytes(32).toString("hex");

    // Expiry time (24 hours)
    const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000
    );

    // Save token in database
    await prisma.qRToken.create({
        data: {
            token,
            participantId,
            expiresAt,
            used: false
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

module.exports = {
    generateQR
};