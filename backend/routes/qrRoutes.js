const express = require("express");
const router = express.Router();

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");
const asyncHandler = require("../utils/asyncHandler");

router.use(authenticate);

router.post("/generate/:participantId", asyncHandler(qrController.generateQR));

router.get("/:token", asyncHandler(qrController.getParticipantByQR));

module.exports = router;