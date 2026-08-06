const express = require("express");

const router = express.Router();

const registrationController = require("../controllers/registrationController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const requirePermission = require("../middlewares/requirePermission");

router.use(requireAuthentication);
router.use(requireAnyRole.operational("REGISTRATION_OFFICER"));

router.post("/", requirePermission("registrations:create"), registrationController.createRegistration);
router.get("/:registrationId", requirePermission("registrations:read"), registrationController.getRegistrationById);
router.get("/:registrationId/history", requirePermission("registrations:read"), registrationController.getRegistrationHistory);
router.patch("/:registrationId/status", requirePermission("registrations:read"), registrationController.changeRegistrationStatus);

module.exports = router;
