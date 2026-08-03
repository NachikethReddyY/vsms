const express = require("express");
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
  reviewParams,
  reviewDecisionBody,
} = require("../schemas/screeningSchemas");

const router = express.Router({ mergeParams: true });
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

router.get(
  "/:eventId/reviews",
  validate({ params: eventParams }),
  asyncHandler(screeningController.listReviews),
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

module.exports = router;
