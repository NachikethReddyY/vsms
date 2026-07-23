const eventService = require("../services/eventService");

exports.list = async (req, res) => res.json(await eventService.listEvents(req.query, req.user));
exports.create = async (req, res) => res.status(201).json(await eventService.createEvent(req.body, req.user, req.requestId));
exports.get = async (req, res) => res.json(await eventService.getEvent(req.params.eventId, req.user));
exports.update = async (req, res) => res.json(await eventService.updateEvent(req.params.eventId, req.body, req.user, req.requestId));
exports.publish = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "publish", req.body, req.user, req.requestId));
exports.start = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "start", req.body, req.user, req.requestId));
exports.complete = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "complete", req.body, req.user, req.requestId));
exports.cancel = async (req, res) => res.json(await eventService.cancelEvent(req.params.eventId, req.body, req.user, req.requestId));
exports.audit = async (req, res) => res.json(await eventService.getAuditLog(req.params.eventId, req.query, req.user));
