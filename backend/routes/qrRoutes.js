const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");

// ==========================================
// Apply Auth Middleware Globally for QR Routes
// (All routes below this line require authentication)
// ==========================================
router.use(authenticate);

// ==========================================
// QR Code Management Routes
// ==========================================

// Generation & Reissuing
router.post("/registrations/:registrationId", asyncHandler(qrController.generateRegistrationQR));
router.post("/generate/:registrationId", asyncHandler(qrController.generateQR));
router.post("/reissue/:registrationId", asyncHandler(qrController.reissueQR));

// Verification & Attendance
router.post("/verify", asyncHandler(qrController.verifyQR));
router.post("/manual-checkin", asyncHandler(qrController.manualCheckIn));

// Participant & History Lookup
router.get("/participant/:token", asyncHandler(qrController.getParticipantByQR));
router.get("/history/:participantId", asyncHandler(qrController.getParticipantQRCodes));

// Revocation & File Output
router.put("/revoke/:qrId", asyncHandler(qrController.revokeQR));
router.get("/download/:qrId", asyncHandler(qrController.downloadQR));
router.get("/print/:qrId", asyncHandler(qrController.printQR));
router.get("/:token", asyncHandler(qrController.getRegistrationByQR));

module.exports = router;
