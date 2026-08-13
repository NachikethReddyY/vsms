const express = require("express");

const router = express.Router();

const participantController = require("../controllers/participantController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const requirePermission = require("../middlewares/requirePermission");
const { rateLimit } = require("../middlewares/security");
const requireRegistrationAssignment = require("../middlewares/requireRegistrationAssignment");

router.use(requireAuthentication);
router.use(requireAnyRole.operational("REGISTRATION_OFFICER"));
router.use(requireRegistrationAssignment);

router.get("/", requirePermission("participants:read"), rateLimit({ windowMs: 60_000, max: 30 }), participantController.searchParticipants);
router.post("/", requirePermission("participants:write"), participantController.createParticipant);
router.post("/match", requirePermission("participants:cross-event-reuse"), rateLimit({ windowMs: 60_000, max: 30 }), participantController.matchParticipantsForRegistration);
router.post("/:participantId/reuse", requirePermission("participants:cross-event-reuse"), participantController.reuseMatchedParticipant);
router.get("/:participantId", requirePermission("participants:read"), participantController.getParticipantById);
router.patch("/:participantId", requirePermission("participants:write"), participantController.updateParticipant);
router.get("/:participantId/registrations", requirePermission("registrations:read"), participantController.getParticipantRegistrations);
router.get("/:participantId/emergency-contacts", requirePermission("participants:read"), participantController.getEmergencyContacts);
router.post("/:participantId/emergency-contacts", requirePermission("participants:write"), participantController.addEmergencyContact);
router.patch("/:participantId/emergency-contacts/:contactId", requirePermission("participants:write"), participantController.updateEmergencyContact);
router.get("/:participantId/events/:eventId/review", requirePermission("registrations:read"), participantController.getRegistrationReview);

module.exports = router;
