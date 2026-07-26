const prisma = require("../prisma/prismaClient");
const crypto = require("crypto");
const AppError = require("../errors/AppError");

// Generate a secure, opaque token for an event registration
const generatePassForRegistration = async (registrationId, userId) => {
  return prisma.$transaction(async (tx) => {
    // Check if pass already exists
    const existing = await tx.qRCodePass.findUnique({
      where: { registrationId },
    });

    if (existing && existing.isActive) {
      return existing;
    }

    // Generate opaque secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours validity

    const qrPass = await tx.qRCodePass.upsert({
      where: { registrationId },
      update: {
        token,
        isActive: true,
        expiresAt,
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
      },
      create: {
        registrationId,
        token,
        expiresAt,
        isActive: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "QR_PASS_GENERATED",
        entityName: "QRCodePass",
        entityId: qrPass.id,
        ipAddress: "::1",
        deviceName: "Server",
      },
    });

    return qrPass;
  });
};

// Verify and process a scanned QR token at a station
const verifyAndScanPass = async (token, stationId, userId, deviceName, ipAddress) => {
  return prisma.$transaction(async (tx) => {
    const qrPass = await tx.qRCodePass.findUnique({
      where: { token },
      include: {
        registration: {
          include: {
            participant: true,
            event: true,
          },
        },
      },
    });

    let scanResult = "SUCCESS";
    
    if (!qrPass) {
      // Log invalid scan attempt
      await tx.scanLog.create({
        data: {
          stationId,
          userId,
          scanResult: "INVALID",
          deviceName,
          ipAddress,
        },
      });
      throw new AppError(404, "INVALID_QR_PASS", "The scanned QR code is invalid.");
    }

    const now = new Date();
    if (!qrPass.isActive || qrPass.revokedAt) {
      scanResult = "REVOKED";
    } else if (qrPass.expiresAt < now) {
      scanResult = "EXPIRED";
    }

    // Record the scan log
    await tx.scanLog.create({
      data: {
        qrId: qrPass.id,
        registrationId: qrPass.registrationId,
        userId,
        stationId,
        scanResult,
        deviceName,
        ipAddress,
      },
    });

    if (scanResult !== "SUCCESS") {
      throw new AppError(400, `QR_${scanResult}`, `Pass status: ${scanResult}`);
    }

    // Automatically check-in participant if not already checked in
    if (!qrPass.registration.checkedIn) {
      await tx.eventRegistration.update({
        where: { id: qrPass.registrationId },
        data: {
          checkedIn: true,
          checkedInAt: now,
          registrationStatus: "CHECKED_IN",
        },
      });
    }

    return {
      success: true,
      registrationId: qrPass.registrationId,
      participant: {
        name: `${qrPass.registration.participant.firstName} ${qrPass.registration.participant.lastName}`,
        maskedNric: qrPass.registration.participant.nricMasked,
      },
      event: qrPass.registration.event.name,
    };
  });
};

// Revoke a QR pass
const revokePass = async (registrationId, userId, reason) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.qRCodePass.update({
      where: { registrationId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedBy: userId,
        revokedReason: reason,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "QR_PASS_REVOKED",
        entityName: "QRCodePass",
        entityId: updated.id,
        newValue: { reason },
        ipAddress: "::1",
        deviceName: "Server",
      },
    });

    return updated;
  });
};

// Manual Fallback: Lookup participant by masked NRIC or phone without exposing full sensitive info
const manualFallbackLookup = async (queryParam, eventId) => {
  const participant = await prisma.participant.findFirst({
    where: {
      OR: [
        { nricMasked: { equals: queryParam } },
        { contactNumber: { contains: queryParam } },
      ],
    },
    include: {
      eventRegistrations: {
        where: { eventId },
        include: { qrCodePass: true },
      },
    },
  });

  if (!participant || participant.eventRegistrations.length === 0) {
    throw new AppError(404, "PARTICIPANT_NOT_FOUND", "No registration found matching fallback criteria.");
  }

  const registration = participant.eventRegistrations[0];

  return {
    registrationId: registration.id,
    fullName: `${participant.firstName} ${participant.lastName}`,
    nricMasked: participant.nricMasked,
    contactNumber: participant.contactNumber,
    checkedIn: registration.checkedIn,
    passToken: registration.qrCodePass?.token || null,
    isActive: registration.qrCodePass?.isActive || false,
  };
};

module.exports = {
  generatePassForRegistration,
  verifyAndScanPass,
  revokePass,
  manualFallbackLookup,
};