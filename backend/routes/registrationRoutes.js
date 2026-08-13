const express = require("express");

const router = express.Router();

const registrationController = require("../controllers/registrationController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const validate = require("../middlewares/validate");
const {
  registrationParams,
  createRegistrationBody,
  registrationStatusBody,
} = require("../schemas/registrationSchemas");

router.use(requireAuthentication);
router.post("/", validate({ body: createRegistrationBody }), registrationController.createRegistration);
router.get("/:registrationId", validate({ params: registrationParams }), registrationController.getRegistrationById);
router.get("/:registrationId/history", validate({ params: registrationParams }), registrationController.getRegistrationHistory);
router.patch(
  "/:registrationId/status",
  validate({ params: registrationParams, body: registrationStatusBody }),
  registrationController.changeRegistrationStatus,
);

module.exports = router;
