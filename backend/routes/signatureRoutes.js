const express = require("express");
const signatureController = require("../controllers/signatureController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const { rateLimit } = require("../middlewares/security");

const router = express.Router();
router.use(requireAuthentication);
router.use(requireAnyRole("ADMINISTRATOR", "REGISTRATION_OFFICER"));
router.post("/", rateLimit({ windowMs: 60_000, max: 30 }), signatureController.storeSignature);

module.exports = router;
