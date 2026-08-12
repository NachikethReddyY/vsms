const screeningService = require("../services/screening/screeningService");
const reviewService = require("../services/screening/reviewService");
const referralService = require("../services/screening/referralService");
const syncService = require("../services/screening/syncService");

exports.syncScreening = async (req, res) => {
  res.json(await syncService.processScreeningSync(
    req.params.eventId,
    req.body,
    req.user,
    req.context,
  ));
};

exports.listStations = async (req, res) => {
  res.json(await screeningService.listStations(req.params.eventId, req.user));
};

exports.listQueue = async (req, res) => {
  res.json(await screeningService.listQueue(req.params.eventId, req.params.stationId, req.user));
};

exports.resolveParticipant = async (req, res) => {
  res.json(await screeningService.resolveParticipant(req.params.eventId, req.query, req.user));
};

exports.getPassDisplay = async (req, res) => {
  res.json(await screeningService.getPassDisplay(
    req.params.eventId,
    req.params.registrationId,
    req.user,
  ));
};

exports.saveVisualAcuity = async (req, res) => {
  const { result, routeProgression, created } = await screeningService.saveVisualAcuity(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
    req.context,
  );
  res.status(created ? 201 : 200).json({ ...result, routeProgression });
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
  const { result, routeProgression, created } = await screeningService.saveRefraction(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
    req.context,
  );
  res.status(created ? 201 : 200).json({ ...result, routeProgression });
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
  const { result, routeProgression, created } = await screeningService.saveColourVision(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
    req.context,
  );
  res.status(created ? 201 : 200).json({ ...result, routeProgression });
};

exports.previewColourVision = async (req, res) => {
  res.json(await screeningService.previewColourVision(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  ));
};

exports.saveEyeHealth = async (req, res) => {
  const { result, routeProgression, created } = await screeningService.saveEyeHealth(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
    req.context,
  );
  res.status(created ? 201 : 200).json({ ...result, routeProgression });
};

exports.previewEyeHealth = async (req, res) => {
  res.json(await screeningService.previewEyeHealth(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  ));
};

exports.saveDynamic = async (req, res) => {
  const { result, routeProgression, created } = await screeningService.saveDynamic(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
    req.context,
  );
  res.status(created ? 201 : 200).json({ ...result, routeProgression });
};

exports.previewDynamic = async (req, res) => {
  res.json(await screeningService.previewDynamic(
    req.params.eventId,
    req.params.stationId,
    req.body,
    req.user,
  ));
};

exports.listReviews = async (req, res) => {
  res.json(await reviewService.listQueue(req.params.eventId, req.user));
};

exports.scanReviewParticipant = async (req, res) => {
  res.json(await reviewService.resolveScannedRegistration(req.params.eventId, req.body.passToken, req.user));
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
    req.context,
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
