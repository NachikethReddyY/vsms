const screeningService = require("../services/screeningService");
const reviewService = require("../services/reviewService");
const referralService = require("../services/referralService");

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

exports.previewVisualAcuity = async (req, res) => {
  res.json(await screeningService.previewVisualAcuity(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  ));
};

exports.saveRefraction = async (req, res) => {
  const { result, created } = await screeningService.saveRefraction(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  );
  res.status(created ? 201 : 200).json(result);
};

exports.previewRefraction = async (req, res) => {
  res.json(await screeningService.previewRefraction(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  ));
};

exports.saveColourVision = async (req, res) => {
  const { result, created } = await screeningService.saveColourVision(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  );
  res.status(created ? 201 : 200).json(result);
};

exports.previewColourVision = async (req, res) => {
  res.json(await screeningService.previewColourVision(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  ));
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

exports.issueReferral = async (req, res) => {
  res.status(201).json(await referralService.issueReferral(
    req.params.eventId,
    req.params.referralId,
    req.body,
    req.user,
    req.ip,
  ));
};

exports.reviseReferral = async (req, res) => {
  res.status(201).json(await referralService.createReferralRevision(
    req.params.eventId,
    req.params.referralId,
    req.body,
    req.user,
    req.ip,
  ));
};

exports.acknowledgeReferralHandoff = async (req, res) => {
  res.json(await referralService.acknowledgeReferralHandoff(
    req.params.eventId,
    req.params.referralId,
    req.body,
    req.user,
    req.ip,
  ));
};

exports.downloadReferralDocument = async (req, res) => {
  const document = await referralService.getDocument(
    req.params.eventId,
    req.params.referralId,
    req.params.documentId,
    req.user,
  );
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${document.filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }).send(document.buffer);
};
