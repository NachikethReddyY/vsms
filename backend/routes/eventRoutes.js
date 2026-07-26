const express = require("express");

const router = express.Router();

const eventController = require("../controllers/eventController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const registrationController = require("../controllers/registrationController");

router.use(requireAuthentication);
router.use(requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER"));
router.get("/active", eventController.getActiveEvents);
router.post("/:eventId/registrations", registrationController.createRegistration);
router.get("/:eventId/registrations", registrationController.listEventRegistrations);
router.get("/:eventId", eventController.getEventById);

module.exports = router;
