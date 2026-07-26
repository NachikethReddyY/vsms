const QRCode = require("qrcode");
const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function generateQR(registrationId, issuedBy) {
    const registration = await prisma.eventRegistration.findUnique({
        where: { id: registrationId },
        select: { id: true, registrationStatus: true },
    });
    if (!registration || registration.registrationStatus === "CANCELLED") {
        const error = new Error("Active registration not found");
        error.statusCode = 404;
        throw error;
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
        await tx.qRCodePass.updateMany({
            where: { registrationId, isActive: true },
            data: {
                isActive: false,
                revokedAt: new Date(),
                revokedBy: issuedBy,
                revokedReason: "Reissued",
            },
        });
        await tx.qRCodePass.create({
            data: {
                registrationId,
                token: tokenHash,
                expiresAt,
            },
        });
    });

    const qrImage = await QRCode.toDataURL(JSON.stringify({ token: rawToken }), {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 300,
    });
    return { registrationId, expiresAt, qrImage };
}

async function getRegistration(rawToken) {
    const tokenHash = hashToken(rawToken);
    const pass = await prisma.qRCodePass.findUnique({
        where: { token: tokenHash },
        include: {
            registration: {
                select: {
                    id: true,
                    queueNumber: true,
                    registrationStatus: true,
                    eventId: true,
                },
            },
        },
    });
    if (!pass || !pass.isActive || pass.expiresAt <= new Date()) {
        const error = new Error("QR code is invalid or expired");
        error.statusCode = 404;
        throw error;
    }
    return pass.registration;
}

module.exports = { generateQR, getRegistration, hashToken };
