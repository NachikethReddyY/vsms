const express = require("express");

const router = express.Router();

const qrController = require("../controllers/qrController");

// ==========================================
// Generate QR Code
// Creates a secure QR Code for an Event Registration
// POST /qr/generate/:registrationId
// ==========================================
router.post(
    "/generate/:registrationId",
    qrController.generateQR
);

// ==========================================
// Verify QR Token
// Validates QR token before check-in
// POST /qr/verify
// ==========================================
router.post(
    "/verify",
    qrController.verifyQR
);

// ==========================================
// Get Participant Details
// Retrieves participant information using QR token
// GET /qr/participant/:token
// ==========================================
router.get(
    "/participant/:token",
    qrController.getParticipantByQR
);

// ==========================================
// Revoke QR Code
// Marks QR as inactive so it can no longer be used
// PUT /qr/revoke/:qrId
// ==========================================
router.put(
    "/revoke/:qrId",
    qrController.revokeQR
);

// ==========================================
// Reissue QR Code
// Revokes existing QR and generates a new one
// POST /qr/reissue/:registrationId
// ==========================================
router.post(
    "/reissue/:registrationId",
    qrController.reissueQR
);

// ==========================================
// Download QR Code
// Returns QR image/data for downloading
// GET /qr/download/:qrId
// ==========================================
router.get(
    "/download/:qrId",
    qrController.downloadQR
);

// ==========================================
// Print QR Code
// Returns printable QR information
// GET /qr/print/:qrId
// ==========================================
router.get(
    "/print/:qrId",
    qrController.printQR
);

// ==========================================
// QR Code History
// Returns all QR Codes issued for a participant
// GET /qr/history/:participantId
// ==========================================
router.get(
    "/history/:participantId",
    qrController.getParticipantQRCodes
);

// ==========================================
// Manual Check-In
// Used when QR cannot be scanned
// POST /qr/manual-checkin
// ==========================================
router.post(
    "/manual-checkin",
    qrController.manualCheckIn
);

module.exports = router;