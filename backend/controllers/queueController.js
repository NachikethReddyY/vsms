const queueService = require("../services/queueService");

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
