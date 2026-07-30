const express = require("express");
const participantController = require("../controllers/participantController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");

const router = express.Router();
router.use(requireAuthentication);
router.use(requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER"));
router.patch("/:contactId", participantController.updateEmergencyContact);

module.exports = router;
