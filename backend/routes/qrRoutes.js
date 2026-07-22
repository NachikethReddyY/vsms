const express = require("express");
const router = express.Router();

const qrController = require("../controllers/qrController");

router.post("/generate/:participantId", qrController.generateQR);

router.get("/:token", qrController.getParticipantByQR);

module.exports = router;