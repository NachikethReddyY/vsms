const express = require("express");
const participantController = require("../controllers/participantController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const requireRegistrationAssignment = require("../middlewares/requireRegistrationAssignment");

const router = express.Router();
router.use(requireAuthentication);
router.use(requireAnyRole.operational("REGISTRATION_OFFICER"));
router.use(requireRegistrationAssignment);
router.patch("/:contactId", participantController.updateEmergencyContact);

module.exports = router;
