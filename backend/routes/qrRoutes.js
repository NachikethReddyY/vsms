const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/http/asyncHandler");

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const { rateLimit } = require("../middlewares/rateLimiter");
const { hashToken } = require("../utils/crypto/qrToken");
const {
  tokenBody,
  tokenParams,
  registrationParams,
  qrPassParams,
  revokeBody,
  manualCheckInBody,
} = require("../schemas/qrSchemas");

// Import your production-grade idempotency middleware
const checkIdempotency = require("../middlewares/idempotency");

// ==========================================
// Public pass-status lookup for the QR scan target.
// (GET requests - Read-only, no idempotency needed)
// ==========================================
const publicStatusTokenLimiter = rateLimit({
  name: "qr-public-status-token",
  windowMs: 60000,
  limit: 15,
  keyGenerator: (req) => hashToken(req.params.token),
});
router.get(
  "/public-status/:token",
  validate({ params: tokenParams }),
  publicStatusTokenLimiter,
  asyncHandler(qrController.getPublicStatus),
);
router.get(
  "/public-pass/:token",
  validate({ params: tokenParams }),
  publicStatusTokenLimiter,
  asyncHandler(qrController.getPublicPass),
);

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

// Station handoff verification is a read-only lookup; attendance changes use
// the idempotent manual-checkin endpoint below.
router.post(
  "/verify",
  validate({ body: tokenBody }),
  asyncHandler(qrController.verifyQR)
);

// Registration desk mutations require retry keys. Redis replays completed
// requests when available; database transactions preserve lifecycle invariants.
router.post("/registrations/:registrationId", checkIdempotency.requireKey, checkIdempotency, validate({ params: registrationParams }), asyncHandler(qrController.generateRegistrationQR));
router.post("/generate/:registrationId", checkIdempotency.requireKey, checkIdempotency, validate({ params: registrationParams }), asyncHandler(qrController.generateQR));
router.post("/reissue/:registrationId", checkIdempotency.requireKey, checkIdempotency, validate({ params: registrationParams }), asyncHandler(qrController.reissueQR));

// Attendance (desk)
router.post("/manual-checkin", checkIdempotency.requireKey, checkIdempotency, validate({ body: manualCheckInBody }), asyncHandler(qrController.manualCheckIn));

// Participant & History Lookup (GET request - read-only)
router.get("/participant/:token", validate({ params: tokenParams }), asyncHandler(qrController.getParticipantByQR));

// Revocation & File Output
router.put("/revoke/:qrId", checkIdempotency.requireKey, checkIdempotency, validate({ params: qrPassParams, body: revokeBody }), asyncHandler(qrController.revokeQR));
router.get("/download/:qrId", validate({ params: qrPassParams }), asyncHandler(qrController.downloadQR));
router.get("/print/:qrId", validate({ params: qrPassParams }), asyncHandler(qrController.printQR));
router.get("/:token", validate({ params: tokenParams }), asyncHandler(qrController.getRegistrationByQR));

module.exports = router;
