/**
 * @fileoverview Queue & Station Transfer Controller
 * @module controllers/queueController
 * @description Handles HTTP requests for virtual queue operations, status tracking, station transitions, priority adjustments, and workload monitoring with robust error boundaries.
 */

const queueService = require("../services/screening/queueService");
const { AppError, ValidationError } = require("../middlewares/errorHandler");

exports.joinQueue = async (req, res) => {
  const { queueEntry, created } = await queueService.joinQueue(
    { eventId: req.params.eventId, stationId: req.params.stationId, registrationId: req.body.registrationId },
    req.user,
    req.context,
  );
  res.status(created ? 201 : 200).json({ queueEntry, created });
};

exports.getEventQueueStatus = async (req, res) => {
  res.json(await queueService.getEventQueueStatus(req.params.eventId, req.user));
};

exports.listRegistrationStations = async (req, res) => {
  res.json(await queueService.listRegistrationStations(req.params.eventId, req.user));
};

exports.createQueueHandoff = async (req, res) => {
  const handoff = await queueService.createQueueHandoff(
    { eventId: req.params.eventId, stationId: req.params.stationId, registrationId: req.body.registrationId },
    req.user,
    req.context,
  );
  res.status(handoff.created ? 201 : 200).json(handoff);
};

exports.getParticipantQueueStatus = async (req, res) => {
  res.json(await queueService.getParticipantQueueStatus(
    req.params.eventId,
    req.params.registrationId,
    req.user,
  ));
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
