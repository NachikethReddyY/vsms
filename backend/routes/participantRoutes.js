const express = require("express");
const router = express.Router();
const participantController = require("../controllers/participantController");

console.log("participantRoutes.js loaded");

// Change "/create" to "/"
router.post("/", participantController.createParticipant);

module.exports = router;