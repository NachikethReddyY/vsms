const eventService = require("../services/eventService");

exports.list = async (req, res) => res.json(await eventService.listEvents(req.query, req.user));
exports.listActive = async (req, res) => res.json(await eventService.listActiveEvents(req.user));
exports.create = async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key");
  res.status(201).json(await eventService.createEvent(req.body, req.user, req.context, idempotencyKey));
};
exports.get = async (req, res) => res.json(await eventService.getEvent(req.params.eventId, req.user));
exports.publicGet = async (req, res) => res.set("Cache-Control", "public, max-age=60").json(await eventService.getPublicEvent(req.params.eventId));
exports.metrics = async (req, res) => res.set("Cache-Control", "no-store").json(await eventService.getEventMetrics(req.params.eventId, req.user));
exports.attendees = async (req, res) => res.set("Cache-Control", "no-store").json(await eventService.listEventAttendees(req.params.eventId, req.query, req.user));
exports.export = async (req, res) => res.set("Cache-Control", "no-store").json(await eventService.exportEvent(req.params.eventId, req.user));
exports.delete = async (req, res) => {
  await eventService.deleteEvent(req.params.eventId, req.body, req.user, req.context);
  res.status(204).end();
};
exports.update = async (req, res) => res.json(await eventService.updateEvent(req.params.eventId, req.body, req.user, req.context));
exports.publish = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "publish", req.body, req.user, req.context));
exports.start = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "start", req.body, req.user, req.context));
exports.complete = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "complete", req.body, req.user, req.context));
exports.cancel = async (req, res) => res.json(await eventService.cancelEvent(req.params.eventId, req.body, req.user, req.context));
exports.staffDirectory = async (_req, res) => res.json(await eventService.listStaffDirectory());
exports.stationTemplates = async (_req, res) => res.json(await eventService.listStationTemplates());
exports.importStations = async (req, res) => res.status(201).json(await eventService.importStations(req.params.eventId, req.body, req.user, req.context));
exports.updateStation = async (req, res) => res.json(await eventService.updateStation(req.params.eventId, req.params.eventStationId, req.body, req.user, req.context));
exports.addAssignment = async (req, res) => res.status(201).json(await eventService.addStaffAssignment(req.params.eventId, req.params.shiftId, req.body, req.user, req.context));
exports.removeAssignment = async (req, res) => res.json(await eventService.removeStaffAssignment(req.params.eventId, req.params.shiftId, req.params.assignmentId, req.query.version, req.user, req.context));
exports.audit = async (req, res) => res.json(await eventService.getAuditLog(req.params.eventId, req.query, req.user));
