const express = require("express");
const qrController = require("../controllers/qrController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const { rateLimit } = require("../middlewares/security");

const router = express.Router();
router.use(requireAuthentication);
router.post(
    "/registrations/:registrationId",
    requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER"),
    qrController.generateQR
);
router.get(
    "/:token",
    rateLimit({ windowMs: 60_000, max: 60 }),
    requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER", "SCREENER"),
    qrController.getRegistrationByQR
);

module.exports = router;
