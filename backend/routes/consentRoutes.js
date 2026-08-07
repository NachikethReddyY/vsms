const express = require("express");
const participantController = require("../controllers/participantController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireRegistrationAssignment = require("../middlewares/requireRegistrationAssignment");

const router = express.Router();
router.use(requireAuthentication);
router.use(requireRegistrationAssignment);
router.get("/active", participantController.getActiveConsentForm);

module.exports = router;
