const express = require("express");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const screeningController = require("../controllers/screeningController");
const {
  eventParams,
  stationParams,
  resolveQuery,
  previewVisualAcuityBody,
  saveVisualAcuityBody,
  previewRefractionBody,
  saveRefractionBody,
  previewColourVisionBody,
  saveColourVisionBody,
  previewEyeHealthBody,
  saveEyeHealthBody,
  reviewParams,
  reviewScanBody,
  reviewDecisionBody,
  referralParams,
  referralDocumentParams,
  issueReferralBody,
  acknowledgeReferralHandoffBody,
  reviseReferralBody,
  screeningSyncBody,
} = require("../schemas/screeningSchemas");

const router = express.Router({ mergeParams: true });

router.use(authenticate);

router.post(
  "/:eventId/sync/screening",
  validate({ params: eventParams, body: screeningSyncBody }),
  asyncHandler(screeningController.syncScreening),
);

router.get(
  "/:eventId/stations",
  validate({ params: eventParams }),
  asyncHandler(screeningController.listStations),
);

router.get(
  "/:eventId/stations/:stationId/queue",
  validate({ params: stationParams }),
  asyncHandler(screeningController.listQueue),
);

router.get(
  "/:eventId/registrations/resolve",
  validate({ params: eventParams, query: resolveQuery }),
  asyncHandler(screeningController.resolveParticipant),
);

router.get(
  "/:eventId/registrations/:registrationId/pass-display",
  validate({ params: reviewParams }),
  asyncHandler(screeningController.getPassDisplay),
);

router.post(
  "/:eventId/stations/:stationId/visual-acuity/preview",
  validate({ params: stationParams, body: previewVisualAcuityBody }),
  asyncHandler(screeningController.previewVisualAcuity),
);

router.post(
  "/:eventId/stations/:stationId/visual-acuity",
  validate({ params: stationParams, body: saveVisualAcuityBody }),
  asyncHandler(screeningController.saveVisualAcuity),
);

router.post(
  "/:eventId/stations/:stationId/refraction/preview",
  validate({ params: stationParams, body: previewRefractionBody }),
  asyncHandler(screeningController.previewRefraction),
);

router.post(
  "/:eventId/stations/:stationId/refraction",
  validate({ params: stationParams, body: saveRefractionBody }),
  asyncHandler(screeningController.saveRefraction),
);

router.post(
  "/:eventId/stations/:stationId/colour-vision/preview",
  validate({ params: stationParams, body: previewColourVisionBody }),
  asyncHandler(screeningController.previewColourVision),
);

router.post(
  "/:eventId/stations/:stationId/colour-vision",
  validate({ params: stationParams, body: saveColourVisionBody }),
  asyncHandler(screeningController.saveColourVision),
);

router.post(
  "/:eventId/stations/:stationId/eye-health/preview",
  validate({ params: stationParams, body: previewEyeHealthBody }),
  asyncHandler(screeningController.previewEyeHealth),
);

router.post(
  "/:eventId/stations/:stationId/eye-health",
  validate({ params: stationParams, body: saveEyeHealthBody }),
  asyncHandler(screeningController.saveEyeHealth),
);

router.get(
  "/:eventId/reviews",
  validate({ params: eventParams }),
  asyncHandler(screeningController.listReviews),
);

router.post(
  "/:eventId/reviews/scan",
  validate({ params: eventParams, body: reviewScanBody }),
  asyncHandler(screeningController.scanReviewParticipant),
);

router.get(
  "/:eventId/reviews/:registrationId",
  validate({ params: reviewParams }),
  asyncHandler(screeningController.getReview),
);

router.post(
  "/:eventId/reviews/:registrationId/decision",
  validate({ params: reviewParams, body: reviewDecisionBody }),
  asyncHandler(screeningController.recordReviewDecision),
);

router.post(
  "/:eventId/referrals/:referralId/revisions",
  validate({ params: referralParams, body: reviseReferralBody }),
  asyncHandler(screeningController.reviseReferral),
);

router.post(
  "/:eventId/referrals/:referralId/issue",
  validate({ params: referralParams, body: issueReferralBody }),
  asyncHandler(screeningController.issueReferral),
);

router.post(
  "/:eventId/referrals/:referralId/issue/acknowledge",
  validate({ params: referralParams, body: acknowledgeReferralHandoffBody }),
  asyncHandler(screeningController.acknowledgeReferralHandoff),
);

router.get(
  "/:eventId/referrals/:referralId/documents/:documentId",
  validate({ params: referralDocumentParams }),
  asyncHandler(screeningController.downloadReferralDocument),
);

module.exports = router;
