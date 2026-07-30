const express = require("express");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const screeningController = require("../controllers/screeningController");
const {
  eventParams,
  stationParams,
  resolveQuery,
  saveVisualAcuityBody,
  reviewParams,
  reviewDecisionBody,
} = require("../schemas/screeningSchemas");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

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
  "/:eventId/stations/:stationId/visual-acuity",
  validate({ params: stationParams, body: saveVisualAcuityBody }),
  asyncHandler(screeningController.saveVisualAcuity),
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
