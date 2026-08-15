const express = require("express");
const { rateLimit } = require("../middlewares/rateLimiter");
const eventController = require("../controllers/eventController");
const reportingController = require("../controllers/reportingController");
const membershipController = require("../controllers/eventMembershipController");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/http/asyncHandler");
const { requireSystemRole } = require("../middlewares/authorize");
const { requireEventManager, requireEventRoles, requireEventRoleAndDuty } = require("../middlewares/requireEventAuthorization");
const requireRecentAuthentication = require("../middlewares/requireRecentAuthentication");
const registrationController = require("../controllers/registrationController");
const { eventRegistrationBody, registrationListQuery } = require("../schemas/registrationSchemas");
const {
    createEventBody,
    updateEventBody,
    transitionBody,
    cancelBody,
    deleteEventBody,
    eventParams,
    listQuery,
    auditQuery,
    attendeeQuery,
    assignmentParams,
    assignmentDeleteParams,
    assignmentBody,
    shiftCreateBody,
    versionQuery,
    stationParams,
    stationImportBody,
    stationUpdateBody,
    stationTemplateParams,
    createStationTemplateBody,
    updateStationTemplateBody,
    reportQuery,
    membershipParams,
    membershipRoleParams,
    membershipBody,
    membershipRemovalBody,
    membershipRoleBody,
    eligibleUsersQuery,
    analyticsQuery,
    reportExportBody,
    reportJobParams,
    reportJobListQuery,
} = require("../schemas/eventSchemas");

const router = express.Router();
const reportingLimiter = rateLimit({
  name: "reporting",
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
router.get("/staff-directory", requireSystemRole("ADMIN"), asyncHandler(eventController.staffDirectory));
router.get("/station-templates/library", requireSystemRole("ADMIN"), asyncHandler(eventController.stationTemplateLibrary));
router.get("/station-templates", asyncHandler(eventController.stationTemplates));
router.post("/station-templates", requireSystemRole("ADMIN"), validate({ body: createStationTemplateBody }), asyncHandler(eventController.createStationTemplate));
router.patch("/station-templates/items/:stationTemplateId", requireSystemRole("ADMIN"), validate({ params: stationTemplateParams, body: updateStationTemplateBody }), asyncHandler(eventController.updateStationTemplate));
router.get("/active", asyncHandler(eventController.listActive));
router.get(
  "/reports/operations",
  reportingLimiter,
  validate({ query: reportQuery }),
  asyncHandler(reportingController.operations),
);

// 2. Base collection routes
router.get("/", validate({ query: listQuery }), asyncHandler(eventController.list));
router.post("/", requireSystemRole("ADMIN"), validate({ body: createEventBody }), asyncHandler(eventController.create));
router.get("/:eventId/memberships/eligible-users", validate({ params: eventParams, query: eligibleUsersQuery }), requireEventManager, asyncHandler(membershipController.eligible));
router.get("/:eventId/memberships", validate({ params: eventParams }), requireEventRoles("EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"), asyncHandler(membershipController.list));
router.post("/:eventId/memberships", validate({ params: eventParams, body: membershipBody }), requireEventManager, asyncHandler(membershipController.add));
router.delete("/:eventId/memberships/:membershipId", validate({ params: membershipParams, body: membershipRemovalBody }), requireEventManager, asyncHandler(membershipController.remove));
router.post("/:eventId/memberships/:membershipId/roles", validate({ params: membershipParams, body: membershipRoleBody }), requireEventManager, asyncHandler(membershipController.addRole));
router.delete("/:eventId/memberships/:membershipId/roles/:role", validate({ params: membershipRoleParams }), requireEventManager, asyncHandler(membershipController.removeRole));
router.post(
  "/:eventId/registrations",
  validate({ params: eventParams, body: eventRegistrationBody }),
  requireEventRoleAndDuty("REGISTRATION"),
  registrationController.createRegistration
);
router.get(
  "/:eventId/registrations",
  validate({ params: eventParams, query: registrationListQuery }),
  requireEventRoleAndDuty("REGISTRATION"),
  registrationController.listEventRegistrations
);
router.get(
  "/:eventId/registrations/summary",
  requireEventRoleAndDuty("REGISTRATION"),
  registrationController.getEventRegistrationSummary
);

// 3. Dynamic parameter routes come last
router.get("/:eventId/metrics", reportingLimiter, validate({ params: eventParams }), requireEventManager, asyncHandler(eventController.metrics));
router.get("/:eventId/analytics", reportingLimiter, validate({ params: eventParams, query: analyticsQuery }), requireEventManager, asyncHandler(reportingController.analytics));
router.post("/:eventId/report-exports", reportingLimiter, requireRecentAuthentication(), validate({ params: eventParams, body: reportExportBody }), requireEventManager, asyncHandler(reportingController.createExport));
router.get("/:eventId/report-exports", reportingLimiter, validate({ params: eventParams, query: reportJobListQuery }), requireEventManager, asyncHandler(reportingController.listExports));
router.get("/:eventId/report-exports/:jobId", reportingLimiter, validate({ params: reportJobParams }), requireEventManager, asyncHandler(reportingController.exportDetail));
router.get("/:eventId/report-exports/:jobId/download", reportingLimiter, requireRecentAuthentication(), validate({ params: reportJobParams }), requireEventManager, asyncHandler(reportingController.downloadExport));
router.get("/:eventId/attendees", reportingLimiter, validate({ params: eventParams, query: attendeeQuery }), requireEventManager, asyncHandler(eventController.attendees));
router.get("/:eventId/export", reportingLimiter, requireRecentAuthentication(), validate({ params: eventParams }), requireEventManager, asyncHandler(eventController.export));
router.get("/:eventId/deletion-preview", requireSystemRole("ADMIN"), validate({ params: eventParams }), asyncHandler(eventController.deletionPreview));
router.get("/:eventId/deletion-cleanup", requireSystemRole("ADMIN"), validate({ params: eventParams }), asyncHandler(eventController.deletionCleanupStatus));
router.get("/:eventId/artwork", validate({ params: eventParams }), requireEventRoles("EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"), asyncHandler(eventController.artwork));
router.get("/:eventId", validate({ params: eventParams }), requireEventRoles("EVENT_MANAGER", "REGISTRATION", "SCREENER", "REVIEWER", "SUPPORT"), asyncHandler(eventController.get));
router.patch("/:eventId", validate({ params: eventParams, body: updateEventBody }), requireEventManager, asyncHandler(eventController.update));
router.post("/:eventId/stations/import", validate({ params: eventParams, body: stationImportBody }), requireEventManager, asyncHandler(eventController.importStations));
router.patch("/:eventId/stations/:eventStationId", validate({ params: stationParams, body: stationUpdateBody }), requireEventManager, asyncHandler(eventController.updateStation));
router.delete("/:eventId/stations/:eventStationId", validate({ params: stationParams, query: versionQuery }), requireEventManager, asyncHandler(eventController.removeStation));
router.post("/:eventId/publish", validate({ params: eventParams, body: transitionBody }), requireEventManager, asyncHandler(eventController.publish));
router.post("/:eventId/start", validate({ params: eventParams, body: transitionBody }), requireEventManager, asyncHandler(eventController.start));
router.post("/:eventId/complete", validate({ params: eventParams, body: transitionBody }), requireEventManager, asyncHandler(eventController.complete));
router.post("/:eventId/cancel", validate({ params: eventParams, body: cancelBody }), requireEventManager, asyncHandler(eventController.cancel));
router.delete("/:eventId", requireSystemRole("ADMIN"), requireRecentAuthentication(), validate({ params: eventParams, body: deleteEventBody }), asyncHandler(eventController.remove));
router.post("/:eventId/shifts/:shiftId/assignments", validate({ params: assignmentParams, body: assignmentBody }), requireEventManager, asyncHandler(eventController.addAssignment));
router.post("/:eventId/shifts", validate({ params: eventParams, body: shiftCreateBody }), requireEventManager, asyncHandler(eventController.addShift));
router.delete("/:eventId/shifts/:shiftId/assignments/:assignmentId", validate({ params: assignmentDeleteParams, query: versionQuery }), requireEventManager, asyncHandler(eventController.removeAssignment));
router.get("/:eventId/audit-log", validate({ params: eventParams, query: auditQuery }), requireEventManager, asyncHandler(eventController.audit));

module.exports = router;
