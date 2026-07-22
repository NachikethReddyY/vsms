const express = require("express");

const router = express.Router();

const participantController = require("../controllers/participantController");

router.post(
    "/create",
    participantController.createParticipant
);

module.exports = router;