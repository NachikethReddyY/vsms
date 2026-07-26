const express = require("express");
const eventController = require("../controllers/eventController");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const { requireSystemRole } = require("../middlewares/authorize");
const {
	createEventBody,
	updateEventBody,
	transitionBody,
	cancelBody,
	eventParams,
	listQuery,
	auditQuery,
	assignmentParams,
	assignmentDeleteParams,
	versionQuery,
	assignmentBody,
	stationParams,
	stationImportBody,
	stationUpdateBody,
} = require("../schemas/eventSchemas");

const router = express.Router();
router.use(authenticate);

router.get("/", validate({ query: listQuery }), asyncHandler(eventController.list));
router.post("/", requireSystemRole("ADMIN", "EVENT_MANAGER"), validate({ body: createEventBody }), asyncHandler(eventController.create));
router.get("/staff-directory", requireSystemRole("ADMIN", "EVENT_MANAGER"), asyncHandler(eventController.staffDirectory));
router.get("/station-templates", requireSystemRole("ADMIN", "EVENT_MANAGER"), asyncHandler(eventController.stationTemplates));
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
router.get("/:eventId/audit-log", validate({ params: eventParams, query: auditQuery }), asyncHandler(eventController.audit));

module.exports = router;
