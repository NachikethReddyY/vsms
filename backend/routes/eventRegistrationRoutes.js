const express = require("express");
const router = express.Router();
const eventRegistrationController = require("../controllers/eventRegistrationController");

// ==========================================
// Register participant for an event
// POST /event-registrations
// ==========================================
// ✅ Change "/create" to "/"
router.post(
    "/",
    eventRegistrationController.createRegistration
);

// ==========================================
// Get registration by ID
// GET /event-registrations/:id
// ==========================================
router.get(
    "/:id",
    eventRegistrationController.getRegistration
);

// ==========================================
// Get registrations for a participant
// GET /event-registrations/participant/:participantId
// ==========================================
router.get(
    "/participant/:participantId",
    eventRegistrationController.getParticipantRegistrations
);

module.exports = router;