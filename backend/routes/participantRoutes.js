const express = require("express");
const participantController = require("../controllers/participantController");
const authenticate = require("../middlewares/authenticate");
const validate = require("../middlewares/validate");
const asyncHandler = require("../utils/asyncHandler");
const { 
  participantParams, 
  participantBody 
} = require("../schemas/participantSchemas");

const router = express.Router();

console.log("participantRoutes.js loaded");

// Apply authentication middleware to all participant routes
router.use(authenticate);

// ==========================================
// Participant Routes
// ==========================================
router.post(
  "/:eventId", 
  validate({ 
    params: participantParams, 
    body: participantBody 
  }), 
  asyncHandler(participantController.createParticipant)
);

module.exports = router;