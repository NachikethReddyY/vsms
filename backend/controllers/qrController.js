const qrService = require("../services/qrService");
const prisma = require("../prisma/prismaClient");
const { assertRegistrationAssignment } = require("../utils/staff");

async function assertQrAccess(req, selectors) {
    const eventId = await qrService.getEventIdForAccess(selectors);
    await assertRegistrationAssignment(prisma, eventId, req.auth);
    return eventId;
}

// Registration-module compatibility endpoint
exports.generateRegistrationQR = async (req, res, next) => {
    try {
        await assertQrAccess(req, { registrationId: req.params.registrationId });
        const qr = await qrService.generateRegistrationQR(
            req.params.registrationId,
            req.auth.userId
        );
        const { token: _token, ...safeQr } = qr;
        return res.status(201).json(safeQr);
    } catch (err) {
        next(err);
    }
};

exports.getRegistrationByQR = async (req, res, next) => {
    try {
        await assertQrAccess(req, { token: req.params.token });
        const result = await qrService.getRegistrationByQR(req.params.token);
        return res.json({ registration: result });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Generate QR Code
// POST /qr/generate/:registrationId
// ==========================================
exports.generateQR = async (req, res, next) => {
    try {
        const { registrationId } = req.params;
        const userId = req.auth.userId;
        await assertQrAccess(req, { registrationId });

        const qr = await qrService.generateQR(registrationId, userId);
        const { token: _token, ...safeQr } = qr;

        return res.status(201).json({
            success: true,
            message: "QR Code generated successfully.",
            data: safeQr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Verify QR Token
// POST /qr/verify
// ==========================================
exports.verifyQR = async (req, res, next) => {
    try {
        const { token, eventId } = req.body;
        const userId = req.auth.userId;
        await assertQrAccess(req, { token, eventId });

        const result = await qrService.verifyQR(token, eventId, userId);

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Get Participant By QR
// GET /qr/participant/:token
// ==========================================
exports.getParticipantByQR = async (req, res, next) => {
    try {
        const { token } = req.params;
        await assertQrAccess(req, { token });
        const participant = await qrService.getParticipant(token);

        return res.status(200).json({
            success: true,
            data: participant
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Revoke QR Code
// PUT /qr/revoke/:qrId
// ==========================================
exports.revokeQR = async (req, res, next) => {
    try {
        const { qrId } = req.params;
        const { revokedReason } = req.body;
        const revokedBy = req.auth.userId;
        await assertQrAccess(req, { qrId });

        const qr = await qrService.revokeQR(qrId, revokedReason, revokedBy);

        return res.status(200).json({
            success: true,
            message: "QR Code revoked successfully.",
            data: qr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Reissue QR Code
// POST /qr/reissue/:registrationId
// ==========================================
exports.reissueQR = async (req, res, next) => {
    try {
        const { registrationId } = req.params;
        const userId = req.auth.userId;
        await assertQrAccess(req, { registrationId });

        const qr = await qrService.reissueQR(registrationId, userId);
        const { token: _token, ...safeQr } = qr;

        return res.status(201).json({
            success: true,
            message: "QR Code reissued successfully.",
            data: safeQr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Download QR Code
// GET /qr/download/:qrId
// ==========================================
exports.downloadQR = async (req, res, next) => {
    try {
        const { qrId } = req.params;
        await assertQrAccess(req, { qrId });
        const qr = await qrService.downloadQR(qrId);

        return res.status(200).json({
            success: true,
            data: qr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Print QR Code
// GET /qr/print/:qrId
// ==========================================
exports.printQR = async (req, res, next) => {
    try {
        const { qrId } = req.params;
        await assertQrAccess(req, { qrId });
        const qr = await qrService.printQR(qrId);

        return res.status(200).json({
            success: true,
            data: qr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Manual Check-In
// POST /qr/manual-checkin
// ==========================================
exports.manualCheckIn = async (req, res, next) => {
    try {
        const { registrationId, identifier, eventId } = req.body;
        const userId = req.auth.userId;
        // Manual identifiers may be either a QR token or an encrypted participant identifier.
        // Authorize the claimed event first; qrService then applies the same active/expiry
        // predicate to QR tokens and verifies that they belong to this event.
        await assertQrAccess(req, { eventId });

        const result = await qrService.manualCheckIn({
            registrationId,
            identifier,
            eventId,
            userId
        });

        return res.status(200).json({
            success: true,
            message: "Participant checked in successfully.",
            data: result
        });
    } catch (err) {
        next(err);
    }
};
