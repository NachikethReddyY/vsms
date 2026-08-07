const express = require("express");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const queueController = require("../controllers/queueController");
const authenticate = require("../middlewares/authenticate");
const checkIdempotency = require("../middlewares/idempotency");
const {
  eventParams,
  stationParams,
  queueEntryParams,
  eventQueueEntryParams,
  participantParams,
  eventParticipantParams,
  joinQueueBody,
  advanceQueueBody,
} = require("../schemas/queueSchemas");

const router = express.Router();

router.use(authenticate);

router.post(
  "/events/:eventId/stations/:stationId/join",
  checkIdempotency,
  validate({ params: stationParams, body: joinQueueBody }),
  asyncHandler(queueController.joinQueue),
);

router.get(
  "/events/:eventId",
  validate({ params: eventParams }),
  asyncHandler(queueController.getEventQueueStatus),
);

router.get(
  "/events/:eventId/participants/:registrationId",
  validate({ params: eventParticipantParams }),
  asyncHandler(queueController.getParticipantQueueStatus),
);

// Compatibility alias: the service derives and authorizes the registration's event.
router.get("/participant/:registrationId", validate({ params: participantParams }), asyncHandler(queueController.getParticipantQueueStatus));

router.patch("/events/:eventId/entries/:queueId/call", validate({ params: eventQueueEntryParams }), asyncHandler(queueController.callQueueEntry));
router.patch("/events/:eventId/entries/:queueId/start", validate({ params: eventQueueEntryParams }), asyncHandler(queueController.startQueueEntry));
router.patch("/events/:eventId/entries/:queueId/advance", checkIdempotency, validate({ params: eventQueueEntryParams, body: advanceQueueBody }), asyncHandler(queueController.advanceQueueEntry));
router.patch("/events/:eventId/entries/:queueId/complete", validate({ params: eventQueueEntryParams }), asyncHandler(queueController.completeQueueEntry));
router.patch("/events/:eventId/entries/:queueId/skip", validate({ params: eventQueueEntryParams }), asyncHandler(queueController.skipQueueEntry));
router.delete("/events/:eventId/entries/:queueId", validate({ params: eventQueueEntryParams }), asyncHandler(queueController.leaveQueue));

router.patch(
  "/entries/:queueId/call",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.callQueueEntry),
);

router.patch(
  "/entries/:queueId/start",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.startQueueEntry),
);

router.patch(
  "/entries/:queueId/advance",
  checkIdempotency,
  validate({ params: queueEntryParams, body: advanceQueueBody }),
  asyncHandler(queueController.advanceQueueEntry),
);

router.patch(
  "/entries/:queueId/complete",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.completeQueueEntry),
);

router.patch(
  "/entries/:queueId/skip",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.skipQueueEntry),
);

router.delete(
  "/entries/:queueId",
  validate({ params: queueEntryParams }),
  asyncHandler(queueController.leaveQueue),
);

module.exports = router;
