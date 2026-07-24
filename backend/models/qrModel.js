const QRCode = require("qrcode");
const crypto = require("crypto");
const os = require("os");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/**
 * Helper: Automatically detects the computer's local IPv4 address on the network
 * so smartphone camera apps on the same Wi-Fi can navigate directly to the page.
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
 * Helper: Constructs the target HTTP web URL encoded inside the QR image.
 */
function buildQRTargetUrl(token) {
    const hostIp = getLocalIpAddress();
    const frontendPort = process.env.FRONTEND_PORT || 3000;
    return `http://${hostIp}:${frontendPort}/participant-status/${token}`;
}

/**
 ==========================================
 Generate Secure QR Code
 ==========================================
 */
async function generateQR(registrationId, userId = null) {
    return await prisma.$transaction(async (tx) => {
        // 1. Check registration exists
        const registration = await tx.eventRegistration.findUnique({
            where: { id: registrationId },
            include: {
                participant: true,
                event: true
            }
        });

        if (!registration) {
            throw new Error("Event registration not found.");
        }

        // 2. Generate cryptographically secure token
        const token = crypto.randomBytes(32).toString("hex");

        // Expiry time (24 hours)
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // 3. Save QR record
        const qrRecord = await tx.qRCodePass.create({
            data: {
                registrationId,
                token,
                expiresAt,
                isActive: true
            }
        });

        // 4. Emit Audit Event
        await tx.auditLog.create({
            data: {
                actorId: userId,
                eventType: "QR_GENERATED",
                targetEntity: "QRCodePass",
                targetEntityId: qrRecord.id,
                metadata: JSON.stringify({ registrationId, expiresAt })
            }
        });

        // 5. Encode full HTTP URL into QR image
        const targetUrl = buildQRTargetUrl(token);
        const qrImage = await QRCode.toDataURL(targetUrl, {
            errorCorrectionLevel: "H",
            margin: 2,
            width: 300
        });

        return {
            qrId: qrRecord.id,
            registrationId,
            token,
            targetUrl,
            issuedAt: qrRecord.issuedAt,
            expiresAt: qrRecord.expiresAt,
            qrImage
        };
    });
}

/**
 ==========================================
 Verify QR Token
 ==========================================
 */
async function verifyQR(token, eventId = null, userId = null) {
    return await prisma.$transaction(async (tx) => {
        const qr = await tx.qRCodePass.findFirst({
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
            throw new Error("QR Code is invalid or does not exist.");
        }

        if (!qr.isActive) {
            throw new Error("QR Code has been revoked.");
        }

        if (new Date() > qr.expiresAt) {
            throw new Error("QR Code has expired.");
        }

        if (eventId && qr.registration.eventId !== eventId) {
            throw new Error("QR Code is not valid for this specific event.");
        }

        // Emit Audit Event
        await tx.auditLog.create({
            data: {
                actorId: userId,
                eventType: "QR_VERIFIED",
                targetEntity: "QRCodePass",
                targetEntityId: qr.id,
                metadata: JSON.stringify({ registrationId: qr.registration.id, eventId })
            }
        });

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
    });
}

/**
 ==========================================
 Get Participant By QR Token
 ==========================================
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
 ==========================================
 Revoke QR Code
 ==========================================
 */
async function revokeQR(qrId, revokedReason = "Revoked by staff", revokedBy = null) {
    return await prisma.$transaction(async (tx) => {
        const qr = await tx.qRCodePass.findUnique({
            where: { id: qrId }
        });

        if (!qr) {
            throw new Error("QR Code not found.");
        }

        if (!qr.isActive) {
            throw new Error("QR Code is already revoked.");
        }

        const updatedQr = await tx.qRCodePass.update({
            where: { id: qrId },
            data: {
                isActive: false,
                revokedAt: new Date(),
                revokedBy,
                revokedReason
            }
        });

        // Emit Audit Event
        await tx.auditLog.create({
            data: {
                actorId: revokedBy,
                eventType: "QR_REVOKED",
                targetEntity: "QRCodePass",
                targetEntityId: qrId,
                metadata: JSON.stringify({ reason: revokedReason })
            }
        });

        return updatedQr;
    });
}

/**
 ==========================================
 Reissue QR Code
 ==========================================
 */
async function reissueQR(registrationId, userId = null) {
    return await prisma.$transaction(async (tx) => {
        // 1. Deactivate existing active QR codes
        await tx.qRCodePass.updateMany({
            where: {
                registrationId,
                isActive: true
            },
            data: {
                isActive: false,
                revokedAt: new Date(),
                revokedBy: userId,
                revokedReason: "Reissued new QR code"
            }
        });

        // 2. Audit deactivation
        await tx.auditLog.create({
            data: {
                actorId: userId,
                eventType: "QR_REISSUED_REVOCATION",
                targetEntity: "EventRegistration",
                targetEntityId: registrationId,
                metadata: JSON.stringify({ action: "Revoked prior active QRs" })
            }
        });

        // 3. Generate new QR pass inside same transaction flow
        return await generateQR(registrationId, userId);
    });
}

/**
 ==========================================
 Download QR Code
 ==========================================
 */
async function downloadQR(qrId) {
    const qr = await prisma.qRCodePass.findUnique({
        where: { id: qrId }
    });

    if (!qr) {
        throw new Error("QR Code not found.");
    }

    const targetUrl = buildQRTargetUrl(qr.token);
    const qrImage = await QRCode.toDataURL(targetUrl, {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 600
    });

    return {
        qrId: qr.id,
        targetUrl,
        qrImage
    };
}

/**
 ==========================================
 Print QR Code
 ==========================================
 */
async function printQR(qrId) {
    return await downloadQR(qrId);
}

/**
 ==========================================
 Get All QR Codes For Participant
 ==========================================
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
 ==========================================
 Manual Check-In (Fallback Procedure)
 ==========================================
 */
async function manualCheckIn(params) {
    const { registrationId, identifier, eventId, userId } = typeof params === "object" ? params : { registrationId: params };

    return await prisma.$transaction(async (tx) => {
        let regIdToUpdate = registrationId;

        // Fallback: If registrationId is not provided directly, lookup via identifier (NRIC or QR Token)
        if (!regIdToUpdate && identifier) {
            // Check by QR token
            const qr = await tx.qRCodePass.findFirst({
                where: { token: identifier }
            });

            if (qr) {
                regIdToUpdate = qr.registrationId;
            } else {
                // Check by Participant NRIC
                const participant = await tx.participant.findFirst({
                    where: { nric: identifier }
                });

                if (participant) {
                    const registration = await tx.eventRegistration.findFirst({
                        where: {
                            participantId: participant.id,
                            ...(eventId ? { eventId } : {})
                        }
                    });

                    if (registration) {
                        regIdToUpdate = registration.id;
                    }
                }
            }
        }

        if (!regIdToUpdate) {
            throw new Error("Registration record not found for manual check-in.");
        }

        // Perform Check-In update
        const updatedRegistration = await tx.eventRegistration.update({
            where: { id: regIdToUpdate },
            data: {
                checkedIn: true,
                checkedInAt: new Date(),
                registrationStatus: "CHECKED_IN"
            },
            include: {
                participant: true,
                event: true
            }
        });

        // Emit Audit Event
        await tx.auditLog.create({
            data: {
                actorId: userId,
                eventType: "MANUAL_CHECKIN_PERFORMED",
                targetEntity: "EventRegistration",
                targetEntityId: regIdToUpdate,
                metadata: JSON.stringify({
                    identifierUsed: identifier || "REGISTRATION_ID",
                    eventId: updatedRegistration.eventId
                })
            }
        });

        return updatedRegistration;
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