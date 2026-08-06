const express = require("express");
const participantController = require("../controllers/participantController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const requirePermission = require("../middlewares/requirePermission");
const requireRegistrationAssignment = require("../middlewares/requireRegistrationAssignment");

const router = express.Router();
router.use(requireAuthentication);
router.use(requireAnyRole.operational("REGISTRATION_OFFICER"));
router.use(requireRegistrationAssignment);
router.get("/active", requirePermission("consents:record"), participantController.getActiveConsentForm);

module.exports = router;
