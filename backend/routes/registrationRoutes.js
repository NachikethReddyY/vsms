const express = require("express");

const router = express.Router();

const registrationController = require("../controllers/registrationController");
const requireAuthentication = require("../middlewares/requireAuthentication");

router.use(requireAuthentication);
router.post("/", registrationController.createRegistration);
router.get("/:registrationId", registrationController.getRegistrationById);
router.get("/:registrationId/history", registrationController.getRegistrationHistory);
router.patch("/:registrationId/status", registrationController.changeRegistrationStatus);

module.exports = router;
