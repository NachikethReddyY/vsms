const express = require("express");
const router = express.Router();
const qrController = require("../controllers/qrController");
// Make sure this path and export style matches your auth middleware!
const { authenticateToken } = require("../middlewares/authMiddleware");
// Middleware applied to all QR routes (if required)
// router.use(authenticateToken);

// Routes
router.post("/generate/:registrationId", qrController.generateQR);
router.post("/verify", qrController.verifyQR);
router.get("/participant/:token", qrController.getParticipantByQR);
router.put("/revoke/:qrId", qrController.revokeQR);
router.post("/reissue/:registrationId", qrController.reissueQR);
router.get("/download/:qrId", qrController.downloadQR);
router.get("/print/:qrId", qrController.printQR);
router.get("/history/:participantId", qrController.getParticipantQRCodes);
router.post("/manual-checkin", qrController.manualCheckIn);

module.exports = router;