const eventService = require("../services/eventService");
const auditService = require("../services/auditService");

exports.list = async (req, res) => res.json(await eventService.listEvents(req.query, req.user));

exports.listActive = async (req, res) => res.json(await eventService.listActiveEvents(req.user));

exports.create = async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key");
<<<<<<< HEAD
  const result = await eventService.createEvent(req.body, req.user, req.requestId, idempotencyKey);
  
  // Trigger Event-Driven Audit Log asynchronously
  await auditService.recordAuditAction(
    "CREATE_EVENT",
    "SECURITY",
    "Event",
    result.id || null,
    req.user,
    req,
    { title: req.body.name }
  );

  res.status(201).json(result);
=======
  res.status(201).json(await eventService.createEvent(req.body, req.user, req.context, idempotencyKey));
>>>>>>> f1cd61b8d8e08f18ef538dda89c72678d88d1033
};

exports.get = async (req, res) => res.json(await eventService.getEvent(req.params.eventId, req.user));
<<<<<<< HEAD

exports.update = async (req, res) => {
  const result = await eventService.updateEvent(req.params.eventId, req.body, req.user, req.requestId);
  
  await auditService.recordAuditAction(
    "UPDATE_EVENT",
    "SECURITY",
    "Event",
    req.params.eventId,
    req.user,
    req,
    req.body
  );

  res.json(result);
};

exports.publish = async (req, res) => {
  const result = await eventService.transitionEvent(req.params.eventId, "publish", req.body, req.user, req.requestId);
  
  await auditService.recordAuditAction(
    "PUBLISH_EVENT",
    "SECURITY",
    "Event",
    req.params.eventId,
    req.user,
    req,
    { status: "PUBLISHED" }
  );

  res.json(result);
};

exports.start = async (req, res) => {
  const result = await eventService.transitionEvent(req.params.eventId, "start", req.body, req.user, req.requestId);
  
  await auditService.recordAuditAction(
    "START_EVENT",
    "SECURITY",
    "Event",
    req.params.eventId,
    req.user,
    req,
    { status: "IN_PROGRESS" }
  );

  res.json(result);
};

exports.complete = async (req, res) => {
  const result = await eventService.transitionEvent(req.params.eventId, "complete", req.body, req.user, req.requestId);
  
  await auditService.recordAuditAction(
    "COMPLETE_EVENT",
    "SECURITY",
    "Event",
    req.params.eventId,
    req.user,
    req,
    { status: "COMPLETED" }
  );

  res.json(result);
};

exports.cancel = async (req, res) => {
  const result = await eventService.cancelEvent(req.params.eventId, req.body, req.user, req.requestId);
  
  await auditService.recordAuditAction(
    "CANCEL_EVENT",
    "SECURITY",
    "Event",
    req.params.eventId,
    req.user,
    req,
    { status: "CANCELLED", reason: req.body.reason }
  );

  res.json(result);
};

=======
exports.publicGet = async (req, res) => res.set("Cache-Control", "public, max-age=60").json(await eventService.getPublicEvent(req.params.eventId));
exports.metrics = async (req, res) => res.set("Cache-Control", "no-store").json(await eventService.getEventMetrics(req.params.eventId, req.user));
exports.attendees = async (req, res) => res.set("Cache-Control", "no-store").json(await eventService.listEventAttendees(req.params.eventId, req.query, req.user));
exports.export = async (req, res) => res.set("Cache-Control", "no-store").json(await eventService.exportEvent(req.params.eventId, req.user));
exports.update = async (req, res) => res.json(await eventService.updateEvent(req.params.eventId, req.body, req.user, req.context));
exports.publish = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "publish", req.body, req.user, req.context));
exports.start = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "start", req.body, req.user, req.context));
exports.complete = async (req, res) => res.json(await eventService.transitionEvent(req.params.eventId, "complete", req.body, req.user, req.context));
exports.cancel = async (req, res) => res.json(await eventService.cancelEvent(req.params.eventId, req.body, req.user, req.context));
exports.remove = async (req, res) => res.json(await eventService.deleteEvent(req.params.eventId, req.body, req.user, req.context));
>>>>>>> f1cd61b8d8e08f18ef538dda89c72678d88d1033
exports.staffDirectory = async (_req, res) => res.json(await eventService.listStaffDirectory());

exports.stationTemplates = async (_req, res) => res.json(await eventService.listStationTemplates());
<<<<<<< HEAD

exports.importStations = async (req, res) => res.status(201).json(await eventService.importStations(req.params.eventId, req.body, req.user, req.requestId));

exports.updateStation = async (req, res) => res.json(await eventService.updateStation(req.params.eventId, req.params.eventStationId, req.body, req.user, req.requestId));

exports.addAssignment = async (req, res) => res.status(201).json(await eventService.addStaffAssignment(req.params.eventId, req.params.shiftId, req.body, req.user, req.requestId));

exports.removeAssignment = async (req, res) => res.json(await eventService.removeStaffAssignment(req.params.eventId, req.params.shiftId, req.params.assignmentId, req.query.version, req.user, req.requestId));

exports.audit = async (req, res) => res.json(await eventService.getAuditLog(req.params.eventId, req.query, req.user));
=======
exports.importStations = async (req, res) => res.status(201).json(await eventService.importStations(req.params.eventId, req.body, req.user, req.context));
exports.updateStation = async (req, res) => res.json(await eventService.updateStation(req.params.eventId, req.params.eventStationId, req.body, req.user, req.context));
exports.addAssignment = async (req, res) => res.status(201).json(await eventService.addStaffAssignment(req.params.eventId, req.params.shiftId, req.body, req.user, req.context));
exports.removeAssignment = async (req, res) => res.json(await eventService.removeStaffAssignment(req.params.eventId, req.params.shiftId, req.params.assignmentId, req.query.version, req.user, req.context));
exports.audit = async (req, res) => res.json(await eventService.getAuditLog(req.params.eventId, req.query, req.user));
>>>>>>> f1cd61b8d8e08f18ef538dda89c72678d88d1033
