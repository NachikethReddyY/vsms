const eventService = require("../services/eventService");

// Helper to wrap async controller handlers so unhandled promise rejections are passed to Next.js / Express error middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ==========================================
// Event CRUD & Core Actions
// ==========================================

exports.list = asyncHandler(async (req, res) => {
  const data = await eventService.listEvents(req.query, req.user);
  res.status(200).json(data);
});

exports.create = asyncHandler(async (req, res) => {
  const data = await eventService.createEvent(req.body, req.user, req.requestId);
  res.status(201).json(data);
});

exports.get = asyncHandler(async (req, res) => {
  const data = await eventService.getEvent(req.params.eventId, req.user);
  res.status(200).json(data);
});

exports.update = asyncHandler(async (req, res) => {
  const data = await eventService.updateEvent(
    req.params.eventId,
    req.body,
    req.user,
    req.requestId
  );
  res.status(200).json(data);
});

// ==========================================
// Lifecycle / Transitions
// ==========================================

exports.publish = asyncHandler(async (req, res) => {
  const data = await eventService.transitionEvent(
    req.params.eventId,
    "publish",
    req.body,
    req.user,
    req.requestId
  );
  res.status(200).json(data);
});

exports.start = asyncHandler(async (req, res) => {
  const data = await eventService.transitionEvent(
    req.params.eventId,
    "start",
    req.body,
    req.user,
    req.requestId
  );
  res.status(200).json(data);
});

exports.complete = asyncHandler(async (req, res) => {
  const data = await eventService.transitionEvent(
    req.params.eventId,
    "complete",
    req.body,
    req.user,
    req.requestId
  );
  res.status(200).json(data);
});

exports.cancel = asyncHandler(async (req, res) => {
  const data = await eventService.cancelEvent(
    req.params.eventId,
    req.body,
    req.user,
    req.requestId
  );
  res.status(200).json(data);
});

// ==========================================
// Staffing & Assignments
// ==========================================

exports.staffDirectory = asyncHandler(async (_req, res) => {
  const data = await eventService.listStaffDirectory();
  res.status(200).json(data);
});

exports.addAssignment = asyncHandler(async (req, res) => {
  const data = await eventService.addStaffAssignment(
    req.params.eventId,
    req.params.shiftId,
    req.body,
    req.user
  );
  res.status(201).json(data);
});

exports.removeAssignment = asyncHandler(async (req, res) => {
  const data = await eventService.removeStaffAssignment(
    req.params.eventId,
    req.params.shiftId,
    req.params.assignmentId,
    req.user
  );
  res.status(200).json(data);
});

// ==========================================
// Audit Logs
// ==========================================

exports.audit = asyncHandler(async (req, res) => {
  const data = await eventService.getAuditLog(
    req.params.eventId,
    req.query,
    req.user
  );
  res.status(200).json(data);
});