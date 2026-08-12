const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/http/asyncHandler");

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const { tokenBody } = require("../schemas/qrSchemas");

// Import your production-grade idempotency middleware
const checkIdempotency = require("../middlewares/idempotency");

// ==========================================
// Public pass-status lookup for the QR scan target.
// (GET requests - Read-only, no idempotency needed)
// ==========================================
router.get("/public-status/:token", asyncHandler(qrController.getPublicStatus));
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

// Station handoff verification: Protected by idempotency to prevent duplicate check-ins/scans
router.post(
  "/verify",
  checkIdempotency,
  validate({ body: tokenBody }),
  asyncHandler(qrController.verifyQR)
);

// Registration desk / QR management: Generation, Reissuing, and Manual Check-ins
// are fully protected against accidental double submission or network retries.
router.post("/registrations/:registrationId", checkIdempotency, asyncHandler(qrController.generateRegistrationQR));
router.post("/generate/:registrationId", checkIdempotency, asyncHandler(qrController.generateQR));
router.post("/reissue/:registrationId", checkIdempotency, asyncHandler(qrController.reissueQR));

// Attendance (desk)
router.post("/manual-checkin", checkIdempotency, asyncHandler(qrController.manualCheckIn));

// Participant & History Lookup (GET request - read-only)
router.get("/participant/:token", asyncHandler(qrController.getParticipantByQR));

// Revocation & File Output
router.put("/revoke/:qrId", checkIdempotency, asyncHandler(qrController.revokeQR));
router.get("/download/:qrId", asyncHandler(qrController.downloadQR));
router.get("/print/:qrId", asyncHandler(qrController.printQR));
router.get("/:token", asyncHandler(qrController.getRegistrationByQR));

module.exports = router;
