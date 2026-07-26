const express = require("express");

const router = express.Router();

const registrationController = require("../controllers/registrationController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");

router.use(requireAuthentication);
router.use(requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER"));

router.post("/", registrationController.createRegistration);
router.get("/:registrationId", registrationController.getRegistrationById);

module.exports = router;
