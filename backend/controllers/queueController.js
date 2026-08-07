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

exports.callQueueEntry = async (req, res) => {
  res.json(await queueService.callQueueEntry(req.params.queueId, req.user, req.context, undefined, req.params.eventId));
};

exports.startQueueEntry = async (req, res) => {
  res.json(await queueService.startQueueEntry(req.params.queueId, req.user, req.context, undefined, req.params.eventId));
};

exports.advanceQueueEntry = async (req, res) => {
  res.json(await queueService.advanceQueueEntry(
    { queueId: req.params.queueId, eventId: req.params.eventId, toStationId: req.body.toStationId, reason: req.body.reason },
    req.user,
    req.context,
  ));
};

exports.completeQueueEntry = async (req, res) => {
  res.json(await queueService.completeQueueEntry(req.params.queueId, req.user, req.context, undefined, req.params.eventId));
};

exports.skipQueueEntry = async (req, res) => {
  res.json(await queueService.skipQueueEntry(req.params.queueId, req.user, req.context, undefined, req.params.eventId));
};

exports.leaveQueue = async (req, res) => {
  res.json(await queueService.leaveQueue(req.params.queueId, req.user, req.context, undefined, req.params.eventId));
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