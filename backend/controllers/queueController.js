/**
 * @fileoverview Queue & Station Transfer Controller
 * @module controllers/queueController
 * @description Handles HTTP requests for virtual queue operations, status tracking, station transitions, priority adjustments, and workload monitoring with robust error boundaries.
 */

const queueService = require("../services/queueService");
const { AppError, ValidationError } = require("../middlewares/errorHandler");

/**
 * Enters a participant into a station's virtual queue.
 * @route POST /api/v1/events/:eventId/stations/:stationId/join
 */
exports.joinQueue = async (req, res, next) => {
  try {
    const { eventId, stationId } = req.params;
    const { registrationId } = req.body;

    if (!registrationId) {
      throw new ValidationError("Registration ID is required to join the queue.");
    }

    const { queueEntry, created } = await queueService.joinQueue(
      { eventId, stationId, registrationId },
      req.user,
      req.context
    );

    return res.status(created ? 201 : 200).json({
      status: "success",
      data: { queueEntry, created }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Retrieves live event queue status and operational metrics.
 * @route GET /api/v1/events/:eventId
 */
exports.getEventQueueStatus = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const status = await queueService.getEventQueueStatus(eventId, req.user);

    return res.status(200).json({
      status: "success",
      data: status
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Tracks an individual participant's queue status and station history.
 * @route GET /api/v1/participant/:registrationId
 */
exports.getParticipantQueueStatus = async (req, res, next) => {
  try {
    const { eventId } = req.query; // Optional fallback or params context
    const { registrationId } = req.params;

    const status = await queueService.getParticipantQueueStatus(
      eventId || req.params.eventId,
      registrationId,
      req.user
    );

    return res.status(200).json({
      status: "success",
      data: status
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Automatically fetches the next waiting participant in line.
 * @route GET /api/v1/events/:eventId/stations/:stationId/next
 */
exports.getNextQueueEntry = async (req, res, next) => {
  try {
    const { eventId, stationId } = req.params;
    const nextEntry = await queueService.getNextQueueEntry(eventId, stationId, req.user);

    return res.status(200).json({
      status: "success",
      data: nextEntry
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Updates queue state to notify/call the participant to the desk.
 * @route PATCH /api/v1/entries/:queueId/call
 */
exports.callQueueEntry = async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const updatedEntry = await queueService.callQueueEntry(queueId, req.user, req.context);

    return res.status(200).json({
      status: "success",
      data: updatedEntry
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Transitions queue status from called to active screening in-progress.
 * @route PATCH /api/v1/entries/:queueId/start
 */
exports.startQueueEntry = async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const startedEntry = await queueService.startQueueEntry(queueId, req.user, req.context);

    return res.status(200).json({
      status: "success",
      data: startedEntry
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Transfers a participant to a secondary screening station.
 * @route PATCH /api/v1/entries/:queueId/transfer
 */
exports.transferQueueEntry = async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const { toStationId, reason } = req.body;

    if (!toStationId) {
      throw new ValidationError("Target destination station ID (toStationId) is required for transfer.");
    }

    const transferredEntry = await queueService.transferQueueEntry(
      { queueId, toStationId, reason },
      req.user,
      req.context
    );

    return res.status(200).json({
      status: "success",
      data: transferredEntry
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Marks the station entry as successfully completed.
 * @route PATCH /api/v1/entries/:queueId/complete
 */
exports.completeQueueEntry = async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const completedEntry = await queueService.completeQueueEntry(queueId, req.user, req.context);

    return res.status(200).json({
      status: "success",
      data: completedEntry
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Skips an unresponsive participant and logs the exception.
 * @route PATCH /api/v1/entries/:queueId/skip
 */
exports.skipQueueEntry = async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const skippedEntry = await queueService.skipQueueEntry(queueId, req.user, req.context);

    return res.status(200).json({
      status: "success",
      data: skippedEntry
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Elevates a queue entry's priority level for urgent medical or special handling.
 * @route PATCH /api/v1/entries/:queueId/priority
 */
exports.updatePriority = async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const { isPriority, notes } = req.body;

    if (typeof isPriority !== 'boolean') {
      throw new ValidationError("Field 'isPriority' must be specified as a boolean value.");
    }

    const priorityEntry = await queueService.updatePriority(
      { queueId, isPriority, notes },
      req.user,
      req.context
    );

    return res.status(200).json({
      status: "success",
      data: priorityEntry
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Fetches live statistics on station traffic, bottlenecks, and active loads.
 * @route GET /api/v1/events/:eventId/workload
 */
exports.getStationWorkload = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const workload = await queueService.getStationWorkload(eventId, req.user);

    return res.status(200).json({
      status: "success",
      data: workload
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Removes a participant from the queue entirely (cancellation/dropout).
 * @route DELETE /api/v1/entries/:queueId
 */
exports.leaveQueue = async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const removedEntry = await queueService.leaveQueue(queueId, req.user, req.context);

    return res.status(200).json({
      status: "success",
      message: "Participant successfully removed from queue.",
      data: removedEntry
    });
  } catch (error) {
    return next(error);
  }
};