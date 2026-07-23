const qrModel = require("../models/qrModel");

// ==========================================
// Generate QR Code
// POST /qr/generate/:registrationId
// ==========================================
exports.generateQR = async (req, res) => {
    try {

        const { registrationId } = req.params;

        if (!registrationId) {
            return res.status(400).json({
                success: false,
                message: "Registration ID is required."
            });
        }

        const qr = await qrModel.generateQR(registrationId);

        return res.status(201).json({
            success: true,
            message: "QR Code generated successfully.",
            data: qr
        });

    } catch (err) {

        console.error("Generate QR Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// Verify QR Token
// POST /qr/verify
// ==========================================
exports.verifyQR = async (req, res) => {
    try {

        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "QR Token is required."
            });
        }

        const result = await qrModel.verifyQR(token);

        return res.status(200).json(result);

    } catch (err) {

        console.error("Verify QR Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// Get Participant By QR
// GET /qr/participant/:token
// ==========================================
exports.getParticipantByQR = async (req, res) => {
    try {

        const { token } = req.params;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "QR Token is required."
            });
        }

        const participant = await qrModel.getParticipant(token);

        return res.status(200).json({
            success: true,
            data: participant
        });

    } catch (err) {

        console.error("Get Participant Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// Revoke QR Code
// PUT /qr/revoke/:qrId
// ==========================================
exports.revokeQR = async (req, res) => {
    try {

        const { qrId } = req.params;
        const { revokedReason, revokedBy } = req.body;

        if (!qrId) {
            return res.status(400).json({
                success: false,
                message: "QR ID is required."
            });
        }

        const qr = await qrModel.revokeQR(
            qrId,
            revokedReason,
            revokedBy
        );

        return res.status(200).json({
            success: true,
            message: "QR Code revoked successfully.",
            data: qr
        });

    } catch (err) {

        console.error("Revoke QR Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// Reissue QR Code
// POST /qr/reissue/:registrationId
// ==========================================
exports.reissueQR = async (req, res) => {
    try {

        const { registrationId } = req.params;

        if (!registrationId) {
            return res.status(400).json({
                success: false,
                message: "Registration ID is required."
            });
        }

        const qr = await qrModel.reissueQR(registrationId);

        return res.status(201).json({
            success: true,
            message: "QR Code reissued successfully.",
            data: qr
        });

    } catch (err) {

        console.error("Reissue QR Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// Download QR Code
// GET /qr/download/:qrId
// ==========================================
exports.downloadQR = async (req, res) => {
    try {

        const { qrId } = req.params;

        if (!qrId) {
            return res.status(400).json({
                success: false,
                message: "QR ID is required."
            });
        }

        const qr = await qrModel.downloadQR(qrId);

        return res.status(200).json({
            success: true,
            data: qr
        });

    } catch (err) {

        console.error("Download QR Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// Print QR Code
// GET /qr/print/:qrId
// ==========================================
exports.printQR = async (req, res) => {
    try {

        const { qrId } = req.params;

        if (!qrId) {
            return res.status(400).json({
                success: false,
                message: "QR ID is required."
            });
        }

        const qr = await qrModel.printQR(qrId);

        return res.status(200).json({
            success: true,
            data: qr
        });

    } catch (err) {

        console.error("Print QR Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// QR History
// GET /qr/history/:participantId
// ==========================================
exports.getParticipantQRCodes = async (req, res) => {
    try {

        const { participantId } = req.params;

        if (!participantId) {
            return res.status(400).json({
                success: false,
                message: "Participant ID is required."
            });
        }

        const qrs = await qrModel.getParticipantQRCodes(participantId);

        return res.status(200).json({
            success: true,
            data: qrs
        });

    } catch (err) {

        console.error("QR History Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// ==========================================
// Manual Check-In
// POST /qr/manual-checkin
// ==========================================
exports.manualCheckIn = async (req, res) => {
    try {

        const { registrationId } = req.body;

        if (!registrationId) {
            return res.status(400).json({
                success: false,
                message: "Registration ID is required."
            });
        }

        const result = await qrModel.manualCheckIn(registrationId);

        return res.status(200).json({
            success: true,
            message: "Participant checked in successfully.",
            data: result
        });

    } catch (err) {

        console.error("Manual Check-In Error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};