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
// 1. GENERATION & REISSUING
// ==========================================
router.post("/generate/:registrationId", asyncHandler(qrController.generateQR));
router.patch("/reissue/:registrationId", asyncHandler(qrController.reissueQR));

// ==========================================
// 2. VERIFICATION & ATTENDANCE
// ==========================================
router.post("/verify", asyncHandler(qrController.verifyQR));
router.post("/check-in/manual", asyncHandler(qrController.manualCheckIn));

// ==========================================
// 3. LOOKUPS & HISTORY
// ==========================================
router.get("/participant/:token", asyncHandler(qrController.getParticipantByQR));
router.get("/participants/:participantId/history", asyncHandler(qrController.getParticipantQRCodes));
router.get("/registrations/:token", asyncHandler(qrController.getRegistrationByQR));

// ==========================================
// 4. MANAGEMENT (REVOCATION, DOWNLOAD, PRINT)
// ==========================================
router.patch("/:qrId/revoke", asyncHandler(qrController.revokeQR));
router.get("/:qrId/download", asyncHandler(qrController.downloadQR));
router.get("/:qrId/print", asyncHandler(qrController.printQR));

module.exports = router;