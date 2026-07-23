const express = require("express");
const eventController = require("../controllers/eventController");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const { requireSystemRole } = require("../middlewares/authorize");
const { createEventBody, updateEventBody, transitionBody, cancelBody, eventParams, listQuery, auditQuery } = require("../schemas/eventSchemas");

const router = express.Router();
router.use(authenticate);

router.get("/", validate({ query: listQuery }), asyncHandler(eventController.list));
router.post("/", requireSystemRole("ADMIN", "EVENT_MANAGER"), validate({ body: createEventBody }), asyncHandler(eventController.create));
router.get("/:eventId", validate({ params: eventParams }), asyncHandler(eventController.get));
router.patch("/:eventId", validate({ params: eventParams, body: updateEventBody }), asyncHandler(eventController.update));
router.post("/:eventId/publish", validate({ params: eventParams, body: transitionBody }), asyncHandler(eventController.publish));
router.post("/:eventId/start", validate({ params: eventParams, body: transitionBody }), asyncHandler(eventController.start));
router.post("/:eventId/complete", validate({ params: eventParams, body: transitionBody }), asyncHandler(eventController.complete));
router.post("/:eventId/cancel", validate({ params: eventParams, body: cancelBody }), asyncHandler(eventController.cancel));
router.get("/:eventId/audit-log", validate({ params: eventParams, query: auditQuery }), asyncHandler(eventController.audit));

module.exports = router;
