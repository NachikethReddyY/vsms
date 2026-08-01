const express = require("express");
const router = express.Router();

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");
const asyncHandler = require("../utils/asyncHandler");
const validate = require("../middlewares/validate");
const { participantParams, tokenParams } = require("../schemas/qrSchemas");

router.use(authenticate);

router.post("/generate/:participantId", validate({ params: participantParams }), asyncHandler(qrController.generateQR));

router.get("/:token", validate({ params: tokenParams }), asyncHandler(qrController.getParticipantByQR));

module.exports = router;
