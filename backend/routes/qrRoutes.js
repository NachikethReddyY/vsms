const express = require("express");

const router = express.Router();

const asyncHandler = require("../utils/http/asyncHandler");
const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const { rateLimit } = require("../middlewares/rateLimiter");
const { hashToken } = require("../utils/crypto/qrToken");
const checkIdempotency = require("../middlewares/idempotency");
const env = require("../config/env");

const {
  tokenBody,
  tokenParams,
  registrationParams,
  qrPassParams,
  revokeBody,
  manualCheckInBody,
} = require("../schemas/qrSchemas");

// ============================================================
// Public QR Status Lookup
// ============================================================
//
// Read-only endpoint used by QR scan targets.
// No authentication is required.
//
// Rate limiting is token-based so one token cannot be used to
// bypass the public QR status rate limit by changing IPs.
// ============================================================

const publicStatusTokenLimiter = rateLimit({
  name: "qr-public-status-token",
  windowMs: 60 * 1000,
  limit: 15,
  keyGenerator: (req) => hashToken(req.params.token),
});

router.get(
  "/public-status/:token",
  validate({ params: tokenParams }),
  publicStatusTokenLimiter,
  asyncHandler(qrController.getPublicStatus)
);

// ============================================================
// Development-only QR Preview Routes
// ============================================================
//
// These routes are intentionally unavailable in production.
// The controller should also enforce the environment check as
// defense in depth.
// ============================================================

if (env.NODE_ENV === "development") {
  router.get(
    "/dev-view/:registrationId",
    validate({ params: registrationParams }),
    asyncHandler(qrController.devViewQR)
  );

  router.get(
    "/dev-page/:registrationId",
    validate({ params: registrationParams }),
    asyncHandler(qrController.devPageQR)
  );

  router.get(
    "/dev-status/:token",
    validate({ params: tokenParams }),
    asyncHandler(qrController.devStatusQR)
  );
}

// ============================================================
// Authenticated QR SVG View
// ============================================================

router.get(
  "/view/:registrationId",
  authenticate,
  validate({ params: registrationParams }),
  asyncHandler(qrController.viewQR)
);

// ============================================================
// Authentication Boundary
// ============================================================
//
// Everything below this point requires authentication.
// ============================================================

router.use(authenticate);

// ============================================================
// QR Verification
// ============================================================
//
// Read-only station handoff verification.
// Does not modify attendance state.
// ============================================================

router.post(
  "/verify",
  validate({ body: tokenBody }),
  asyncHandler(qrController.verifyQR)
);

// ============================================================
// QR Generation / Reissue
// ============================================================
//
// Idempotency protects these mutation endpoints from duplicate
// requests caused by retries, double-clicks, or network issues.
// ============================================================

router.post(
  "/registrations/:registrationId",
  checkIdempotency,
  asyncHandler(qrController.generateRegistrationQR)
);

router.post(
  "/generate/:registrationId",
  checkIdempotency,
  asyncHandler(qrController.generateQR)
);

router.post(
  "/reissue/:registrationId",
  checkIdempotency,
  asyncHandler(qrController.reissueQR)
);

// ============================================================
// Manual Check-in
// ============================================================
//
// A valid idempotency key is mandatory because this operation
// changes attendance state.
// ============================================================

router.post(
  "/manual-checkin",
  checkIdempotency.requireKey,
  checkIdempotency,
  validate({ body: manualCheckInBody }),
  asyncHandler(qrController.manualCheckIn)
);

// ============================================================
// Participant Lookup
// ============================================================
//
// Read-only lookup using a QR token.
// ============================================================

router.get(
  "/participant/:token",
  validate({ params: tokenParams }),
  asyncHandler(qrController.getParticipantByQR)
);

// ============================================================
// QR Revocation
// ============================================================
//
// Revocation changes QR state, therefore an idempotency key is
// mandatory.
// ============================================================

router.put(
  "/revoke/:qrId",
  checkIdempotency.requireKey,
  checkIdempotency,
  validate({
    params: qrPassParams,
    body: revokeBody,
  }),
  asyncHandler(qrController.revokeQR)
);

// ============================================================
// QR File Output
// ============================================================

router.get(
  "/download/:qrId",
  validate({ params: qrPassParams }),
  asyncHandler(qrController.downloadQR)
);

router.get(
  "/print/:qrId",
  validate({ params: qrPassParams }),
  asyncHandler(qrController.printQR)
);

// ============================================================
// QR Token Lookup
// ============================================================
//
// Keep this route last because "/:token" is a catch-all parameter
// route and could otherwise intercept more specific routes.
// ============================================================

router.get(
  "/:token",
  validate({ params: tokenParams }),
  asyncHandler(qrController.getRegistrationByQR)
);

module.exports = router;
