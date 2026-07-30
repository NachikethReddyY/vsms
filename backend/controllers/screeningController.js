const screeningService = require("../services/screeningService");
const reviewService = require("../services/reviewService");

exports.listStations = async (req, res) => {
  res.json(await screeningService.listStations(req.params.eventId, req.user));
};

exports.listQueue = async (req, res) => {
  res.json(await screeningService.listQueue(req.params.eventId, req.params.stationId, req.user));
};

exports.resolveParticipant = async (req, res) => {
  res.json(await screeningService.resolveParticipant(req.params.eventId, req.query, req.user));
};

exports.saveVisualAcuity = async (req, res) => {
  const { result, created } = await screeningService.saveVisualAcuity(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  );
  res.status(created ? 201 : 200).json(result);
};

exports.listReviews = async (req, res) => {
  res.json(await reviewService.listQueue(req.params.eventId, req.user));
};

exports.getReview = async (req, res) => {
  res.json(await reviewService.getDetail(req.params.eventId, req.params.registrationId, req.user));
};

exports.recordReviewDecision = async (req, res) => {
  res.status(201).json(await reviewService.recordDecision(
    req.params.eventId,
    req.params.registrationId,
    req.body,
    req.user,
    req.ip,
  ));
};
