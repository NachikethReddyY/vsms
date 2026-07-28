const participantService = require("../services/participantService");

const actorFrom = (req) => ({
  ...req.user,
  ipAddress: req.ip,
  requestId: req.requestId,
});

exports.search = async (req, res) => {
  const result = await participantService.searchParticipants(req.body, actorFrom(req));
  return res.status(200).json(result);
};

exports.profile = async (req, res) => {
  const participant = await participantService.getParticipantProfile(
    req.params.participantId,
    req.query.eventId,
    actorFrom(req),
  );
  return res.status(200).json({ participant });
};

exports.update = async (req, res) => {
  const participant = await participantService.updateParticipant(
    req.params.participantId,
    req.body,
    actorFrom(req),
  );
  return res.status(200).json({ participant });
};

exports.registrationHistory = async (req, res) => {
  const result = await participantService.getRegistrationHistory(
    req.params.participantId,
    req.query,
    actorFrom(req),
  );
  return res.status(200).json(result);
};
