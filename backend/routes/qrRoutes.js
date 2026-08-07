const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");

// ==========================================
// Public pass-status lookup for the QR scan target.
// Intentionally mounted before auth: only non-sensitive
// validity/queue/expiry data is returned, never names or PII.
// ==========================================
router.get("/public-status/:token", asyncHandler(qrController.getPublicStatus));

// Public screener-handoff QR. Encodes only a station URL pre-loaded with the
// registration reference; the station page itself stays role-guarded.
router.get("/handoff/:token", asyncHandler(qrController.getStationHandoffQR));

// ==========================================
// Dev-only QR preview (no auth). Blocked in production by controller.
// ==========================================
router.get("/dev-view/:registrationId", asyncHandler(qrController.devViewQR));
router.get("/dev-page/:registrationId", asyncHandler(qrController.devPageQR));
router.get("/dev-status/:token", asyncHandler(qrController.devStatusQR));

// ==========================================
// View QR code as SVG in browser (authenticated)
// ==========================================
router.get(
  "/view/:registrationId",
  authenticate,
  asyncHandler(qrController.viewQR)
);

// ==========================================
// Authenticated QR routes
// ==========================================
router.use(authenticate);

// Station handoff: screeners verify passes; officers keep the same capability.
router.post(
  "/verify",
  asyncHandler(qrController.verifyQR),
);

// Registration desk / QR management stays registration-officer only.
// Generation & Reissuing
router.post("/registrations/:registrationId", asyncHandler(qrController.generateRegistrationQR));
router.post("/generate/:registrationId", asyncHandler(qrController.generateQR));
router.post("/reissue/:registrationId", asyncHandler(qrController.reissueQR));

// Attendance (desk)
router.post("/manual-checkin", asyncHandler(qrController.manualCheckIn));

// Participant & History Lookup
router.get("/participant/:token", asyncHandler(qrController.getParticipantByQR));

// Revocation & File Output
router.put("/revoke/:qrId", asyncHandler(qrController.revokeQR));
router.get("/download/:qrId", asyncHandler(qrController.downloadQR));
router.get("/print/:qrId", asyncHandler(qrController.printQR));
router.get("/:token", asyncHandler(qrController.getRegistrationByQR));

module.exports = router;
