const qrService = require("../services/qrServices");

// Registration-module compatibility endpoint
exports.generateRegistrationQR = async (req, res, next) => {
    try {
        const qr = await qrService.generateRegistrationQR(
            req.params.registrationId, 
            req.user?.id || req.auth?.userId
        );
        return res.status(201).json(qr);
    } catch (err) {
        next(err);
    }
};

exports.getRegistrationByQR = async (req, res, next) => {
    try {
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
        const userId = req.user?.id;

        const qr = await qrService.generateQR(registrationId, userId);

        return res.status(201).json({
            success: true,
            message: "QR Code generated successfully.",
            data: qr
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
        const userId = req.user?.id;
        const deviceName = req.headers["user-agent"] || "API-Client";
        const ipAddress = req.ip || "::1";

        const result = await qrService.verifyAndScanPass(token, eventId, userId, deviceName, ipAddress);

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
        const revokedBy = req.body.revokedBy || req.user?.id;

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
        const userId = req.user?.id;

        const qr = await qrService.reissueQR(registrationId, userId);

        return res.status(201).json({
            success: true,
            message: "QR Code reissued successfully.",
            data: qr
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
// QR History
// GET /qr/history/:participantId
// ==========================================
exports.getParticipantQRCodes = async (req, res, next) => {
    try {
        const { participantId } = req.params;
        const qrs = await qrService.getParticipantQRCodes(participantId);

        return res.status(200).json({
            success: true,
            data: qrs
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
        const userId = req.user?.id;

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