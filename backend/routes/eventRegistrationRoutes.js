const express = require("express");

const router = express.Router();

const eventRegistrationController = require("../controllers/eventRegistrationController");

// ==========================================
// Register participant for an event
// POST /event-registration/create
// ==========================================
router.post(
    "/create",
    eventRegistrationController.createRegistration
);

// ==========================================
// Get registration by ID
// GET /event-registration/:id
// ==========================================
router.get(
    "/:id",
    eventRegistrationController.getRegistration
);

// ==========================================
// Get registrations for a participant
// GET /event-registration/participant/:participantId
// ==========================================
router.get(
    "/participant/:participantId",
    eventRegistrationController.getParticipantRegistrations
);

module.exports = router;