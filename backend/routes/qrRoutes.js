const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");
const requireAnyRole = require("../middlewares/requireAnyRole");

// ==========================================
// Apply Auth Middleware Globally for QR Routes
// (All routes below this line require authentication)
// ==========================================
router.use(authenticate);
router.use(requireAnyRole.operational("REGISTRATION_OFFICER"));

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
<<<<<<< HEAD
router.get("/participants/:participantId/history", asyncHandler(qrController.getParticipantQRCodes));
router.get("/registrations/:token", asyncHandler(qrController.getRegistrationByQR));
=======
>>>>>>> f1cd61b8d8e08f18ef538dda89c72678d88d1033

// ==========================================
// 4. MANAGEMENT (REVOCATION, DOWNLOAD, PRINT)
// ==========================================
router.patch("/:qrId/revoke", asyncHandler(qrController.revokeQR));
router.get("/:qrId/download", asyncHandler(qrController.downloadQR));
router.get("/:qrId/print", asyncHandler(qrController.printQR));

module.exports = router;