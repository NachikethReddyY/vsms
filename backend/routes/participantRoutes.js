const express = require("express");

const router = express.Router();

const participantController = require("../controllers/participantController");
console.log("participantRoutes.js loaded");
router.post(
    "/create",
    participantController.createParticipant
);

module.exports = router;