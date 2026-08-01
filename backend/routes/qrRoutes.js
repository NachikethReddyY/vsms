const express = require("express");
const router = express.Router();

const qrController = require("../controllers/qrController");
const authenticate = require("../middlewares/authenticate");
const asyncHandler = require("../utils/asyncHandler");
const validate = require("../middlewares/validate");
const { participantParams, tokenBody } = require("../schemas/qrSchemas");

router.use(authenticate);

router.post("/generate/:participantId", validate({ params: participantParams }), asyncHandler(qrController.generateQR));

router.post("/resolve", validate({ body: tokenBody }), asyncHandler(qrController.getParticipantByQR));

module.exports = router;
