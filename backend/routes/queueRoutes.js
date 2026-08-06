/**
 * @fileoverview Queue & Station Transfer Router
 * @module routes/queueRoutes
 * @description Manages virtual queue entry, station transitions, priority overrides, and operational workload monitoring.
 */

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
  transferQueueBody,
  priorityQueueBody
} = require("../schemas/queueSchemas");

const router = express.Router();

/**
 * Global Middleware: Enforces active JWT authentication across all queue endpoints.
 */
router.use(requireAuthentication);

/**
 * @route   POST /events/:eventId/stations/:stationId/join
 * @desc    Enters a registered participant into a station's virtual queue
 * @access  Registration Officer, Event Manager, Administrator
 */
router.post(
  "/events/:eventId/stations/:stationId/join",
  requireAnyRole("REGISTRATION_OFFICER", "EVENT_MANAGER", "ADMINISTRATOR"),
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
  "/participant/:registrationId",
  requireAnyRole("REGISTRATION_OFFICER", "SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: participantParams
  }),
  asyncHandler(queueController.getParticipantQueueStatus)
);

/**
 * @route   GET /events/:eventId/stations/:stationId/next
 * @desc    Automatically fetches the next waiting participant in line
 * @access  Screener, Event Manager, Administrator
 */
router.get(
  "/events/:eventId/stations/:stationId/next",
  requireAnyRole("SCREENER", "EVENT_MANAGER", "ADMINISTRATOR"),
  validate({
    params: stationParams
  }),
  asyncHandler(queueController.getNextQueueEntry)
);

/**
 * @route   PATCH /entries/:queueId/call
 * @desc    Updates queue state to notify/call the participant to the desk
 * @access  Screener, Event Manager, Administrator
 */
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
  asyncHandler(queueController.transferQueueEntry)
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
