const express = require("express");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const queueController = require("../controllers/queueController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const checkIdempotency = require("../middlewares/idempotency");
const {
  eventParams,
  stationParams,
  queueEntryParams,
  participantParams,
  joinQueueBody,
  advanceQueueBody,
} = require("../schemas/queueSchemas");

const router = express.Router();

router.use(requireAuthentication);
router.use(requireAnyRole("REGISTRATION_OFFICER", "SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"));

router.post(
  "/:eventId/stations/:stationId/join",
  checkIdempotency,
  validate({ params: stationParams, body: joinQueueBody }),
  asyncHandler(queueController.joinQueue),
);

router.get(
  "/:eventId",
  validate({ params: eventParams }),
  asyncHandler(queueController.getEventQueueStatus),
);

router.get(
  "/participant/:registrationId",
  validate({ params: participantParams }),
  asyncHandler(queueController.getParticipantQueueStatus),
);

router.patch(
  "/:queueId/call",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.callQueueEntry),
);

router.patch(
  "/:queueId/start",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.startQueueEntry),
);

router.patch(
  "/:queueId/advance",
  checkIdempotency,
  validate({ params: queueEntryParams, body: advanceQueueBody }),
  asyncHandler(queueController.advanceQueueEntry),
);

router.patch(
  "/:queueId/complete",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.completeQueueEntry),
);

router.patch(
  "/:queueId/skip",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.skipQueueEntry),
);

router.delete(
  "/:queueId",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.leaveQueue),
);

module.exports = router;
