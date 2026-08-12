/**
 * @fileoverview Queue & Station Transfer Router
 * @module routes/queueRoutes
 * @description Manages virtual queue entry, station transitions, priority overrides, and operational workload monitoring.
 */

const express = require("express");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/http/asyncHandler");

const queueController = require("../controllers/queueController");
const authenticate = require("../middlewares/authenticate");
const requireAnyRole = require("../middlewares/requireAnyRole");
const checkIdempotency = require("../middlewares/idempotency");

const {
  eventParams,
  stationParams,
  queueEntryParams,
  eventQueueEntryParams,
  participantParams,
  eventParticipantParams,
  joinQueueBody,
  queueHandoffBody,
  transferQueueBody,
  advanceQueueBody,
  redirectQueueBody,
  priorityQueueBody
} = require("../schemas/queueSchemas");

const router = express.Router();

router.use(authenticate);

/**
 * @route   POST /events/:eventId/stations/:stationId/join
 * @desc    Enters a registered participant into a station's virtual queue
 * @access  Registration Officer, Event Manager, Administrator
 */
router.post(
  "/events/:eventId/stations/:stationId/join",
  requireAnyRole("REGISTRATION_OFFICER", "SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  checkIdempotency,
  validate({
    params: stationParams,
    body: joinQueueBody
  }),
  asyncHandler(queueController.joinQueue)
);

/**
 * @route   GET /events/:eventId
 * @desc    Retrieves live event queue status and operational metrics
 * @access  Staff Roles
 */
router.get(
  "/events/:eventId/stations",
  validate({ params: eventParams }),
  asyncHandler(queueController.listRegistrationStations),
);

router.post(
  "/events/:eventId/stations/:stationId/handoff",
  checkIdempotency,
  validate({ params: stationParams, body: queueHandoffBody }),
  asyncHandler(queueController.createQueueHandoff),
);

/**
 * @route   POST /events/:eventId/stations/:stationId/redirect
 * @desc    Staff override: redirect a participant to a chosen station
 * @access  Screener, Event Manager, Administrator
 */
router.post(
  "/events/:eventId/stations/:stationId/redirect",
  requireAnyRole("SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  checkIdempotency,
  validate({ params: stationParams, body: redirectQueueBody }),
  asyncHandler(queueController.redirectQueueEntry),
);

router.get(
  "/events/:eventId",
  requireAnyRole("REGISTRATION_OFFICER", "SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: eventParams
  }),
  asyncHandler(queueController.getEventQueueStatus)
);

/**
 * @route   GET /participant/:registrationId
 * @desc    Tracks an individual participant's queue status and station history
 * @access  Staff Roles
 */
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
router.patch("/events/:eventId/entries/:queueId/priority", requireAnyRole("EVENT_MANAGER", "ADMINISTRATOR"), checkIdempotency, validate({ params: eventQueueEntryParams, body: priorityQueueBody }), asyncHandler(queueController.updatePriority));
router.delete("/events/:eventId/entries/:queueId", validate({ params: eventQueueEntryParams }), asyncHandler(queueController.leaveQueue));

router.patch(
  "/entries/:queueId/call",
  requireAnyRole("SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: queueEntryParams
  }),
  asyncHandler(queueController.callQueueEntry)
);

/**
 * @route   PATCH /entries/:queueId/start
 * @desc    Transitions queue status from called to active screening in-progress
 * @access  Screener (Strict)
 */
router.patch(
  "/entries/:queueId/start",
  requireAnyRole("SCREENER"),
  validate({
    params: queueEntryParams
  }),
  asyncHandler(queueController.startQueueEntry)
);

/**
 * @route   PATCH /entries/:queueId/transfer
 * @desc    Transfers a participant to a secondary screening station (e.g., visual acuity to refraction)
 * @access  Screener, Event Manager, Administrator
 */
router.patch(
  "/entries/:queueId/transfer",
  requireAnyRole("SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  checkIdempotency,
  validate({
    params: queueEntryParams,
    body: transferQueueBody
  }),
  asyncHandler(queueController.advanceQueueEntry)
);

/**
 * @route   PATCH /entries/:queueId/complete
 * @desc    Marks the station entry as successfully completed
 * @access  Screener
 */
router.patch(
  "/entries/:queueId/complete",
  requireAnyRole("SCREENER"),
  validate({
    params: queueEntryParams
  }),
  asyncHandler(queueController.completeQueueEntry)
);

/**
 * @route   PATCH /entries/:queueId/skip
 * @desc    Skips an unresponsive participant and logs the exception
 * @access  Screener, Event Manager, Administrator
 */
router.patch(
  "/entries/:queueId/skip",
  requireAnyRole("SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: queueEntryParams
  }),
  asyncHandler(queueController.skipQueueEntry)
);

/**
 * @route   PATCH /entries/:queueId/priority
 * @desc    Elevates a queue entry's priority level for urgent medical or special handling
 * @access  Event Manager, Administrator
 */
router.patch(
  "/entries/:queueId/priority",
  requireAnyRole("EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: queueEntryParams,
    body: priorityQueueBody
  }),
  asyncHandler(queueController.updatePriority)
);

/**
 * @route   GET /events/:eventId/workload
 * @desc    Fetches live statistics on station traffic, bottlenecks, and active loads
 * @access  Event Manager, Administrator
 */
router.get(
  "/events/:eventId/workload",
  requireAnyRole("EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: eventParams
  }),
  asyncHandler(queueController.getStationWorkload)
);

/**
 * @route   DELETE /entries/:queueId
 * @desc    Removes a participant from the queue entirely (cancellation/dropout)
 * @access  Registration Officer, Event Manager, Administrator
 */
router.delete(
  "/entries/:queueId",
  requireAnyRole("REGISTRATION_OFFICER", "EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: queueEntryParams
  }),
  asyncHandler(queueController.leaveQueue)
);

module.exports = router;
