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

module.exports = router;
