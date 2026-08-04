const express = require("express");
const { rateLimit } = require("express-rate-limit");
const eventController = require("../controllers/eventController");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const { requireSystemRole } = require("../middlewares/authorize");
const requireAnyRole = require("../middlewares/requireAnyRole");
const registrationController = require("../controllers/registrationController");
const {
    createEventBody,
    updateEventBody,
    transitionBody,
    cancelBody,
    eventParams,
    listQuery,
    auditQuery,
    attendeeQuery,
    deleteEventBody,
    assignmentParams,
    assignmentDeleteParams,
    assignmentBody,
    versionQuery,
    stationParams,
    stationImportBody,
    stationUpdateBody,
} = require("../schemas/eventSchemas");

const router = express.Router();
const reportingLimiter = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user.userId,
});
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// 1. Static routes MUST come first so they are not captured by dynamic parameters like /:eventId
router.get("/staff-directory", requireSystemRole("ADMIN", "EVENT_MANAGER"), asyncHandler(eventController.staffDirectory));
router.get("/station-templates", asyncHandler(eventController.stationTemplates));
router.get("/active", asyncHandler(eventController.listActive));

// 2. Base collection routes
router.get("/", validate({ query: listQuery }), asyncHandler(eventController.list));
router.post("/", requireSystemRole("ADMIN", "EVENT_MANAGER"), validate({ body: createEventBody }), asyncHandler(eventController.create));
router.post(
  "/:eventId/registrations",
  requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER"),
  registrationController.createRegistration
);
router.get(
  "/:eventId/registrations",
  requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER"),
  registrationController.listEventRegistrations
);

// 3. Dynamic parameter routes come last
router.get("/:eventId/metrics", reportingLimiter, validate({ params: eventParams }), asyncHandler(eventController.metrics));
router.get("/:eventId/attendees", reportingLimiter, validate({ params: eventParams, query: attendeeQuery }), asyncHandler(eventController.attendees));
router.get("/:eventId/export", reportingLimiter, validate({ params: eventParams }), asyncHandler(eventController.export));
router.delete("/:eventId", validate({ params: eventParams, body: deleteEventBody }), asyncHandler(eventController.delete));
router.get("/:eventId", validate({ params: eventParams }), asyncHandler(eventController.get));
router.patch("/:eventId", validate({ params: eventParams, body: updateEventBody }), asyncHandler(eventController.update));
router.post("/:eventId/stations/import", validate({ params: eventParams, body: stationImportBody }), asyncHandler(eventController.importStations));
router.patch("/:eventId/stations/:eventStationId", validate({ params: stationParams, body: stationUpdateBody }), asyncHandler(eventController.updateStation));
router.post("/:eventId/publish", validate({ params: eventParams, body: transitionBody }), asyncHandler(eventController.publish));
router.post("/:eventId/start", validate({ params: eventParams, body: transitionBody }), asyncHandler(eventController.start));
router.post("/:eventId/complete", validate({ params: eventParams, body: transitionBody }), asyncHandler(eventController.complete));
router.post("/:eventId/cancel", validate({ params: eventParams, body: cancelBody }), asyncHandler(eventController.cancel));
router.post("/:eventId/shifts/:shiftId/assignments", validate({ params: assignmentParams, body: assignmentBody }), asyncHandler(eventController.addAssignment));
router.delete("/:eventId/shifts/:shiftId/assignments/:assignmentId", validate({ params: assignmentDeleteParams, query: versionQuery }), asyncHandler(eventController.removeAssignment));
router.get("/:eventId/audit-log", reportingLimiter, validate({ params: eventParams, query: auditQuery }), asyncHandler(eventController.audit));

module.exports = router;
