const queueService = require("../services/queueService");

exports.joinQueue = async (req, res) => {
  const { queueEntry, created } = await queueService.joinQueue(
    { eventId: req.params.eventId, stationId: req.params.stationId, registrationId: req.body.registrationId },
    req.auth,
    req.context,
  );
  res.status(created ? 201 : 200).json({ queueEntry, created });
};

exports.getEventQueueStatus = async (req, res) => {
  res.json(await queueService.getEventQueueStatus(req.params.eventId, req.auth));
};

exports.listRegistrationStations = async (req, res) => {
  res.json(await queueService.listRegistrationStations(req.params.eventId, req.auth));
};

exports.createQueueHandoff = async (req, res) => {
  const handoff = await queueService.createQueueHandoff(
    { eventId: req.params.eventId, stationId: req.params.stationId, registrationId: req.body.registrationId },
    req.auth,
    req.context,
  );
  res.status(handoff.created ? 201 : 200).json(handoff);
};

exports.getParticipantQueueStatus = async (req, res) => {
  res.json(await queueService.getParticipantQueueStatus(
    req.params.eventId,
    req.params.registrationId,
    req.auth,
  ));
};

exports.callQueueEntry = async (req, res) => {
  res.json(await queueService.callQueueEntry(req.params.queueId, req.auth, req.context));
};

exports.startQueueEntry = async (req, res) => {
  res.json(await queueService.startQueueEntry(req.params.queueId, req.auth, req.context));
};

exports.advanceQueueEntry = async (req, res) => {
  res.json(await queueService.advanceQueueEntry(
    { queueId: req.params.queueId, toStationId: req.body.toStationId, reason: req.body.reason },
    req.auth,
    req.context,
 ));
};

exports.completeQueueEntry = async (req, res) => {
  res.json(await queueService.completeQueueEntry(req.params.queueId, req.auth, req.context));
};

exports.skipQueueEntry = async (req, res) => {
  res.json(await queueService.skipQueueEntry(req.params.queueId, req.auth, req.context));
};

exports.leaveQueue = async (req, res) => {
  res.json(await queueService.leaveQueue(req.params.queueId, req.auth, req.context));
};
