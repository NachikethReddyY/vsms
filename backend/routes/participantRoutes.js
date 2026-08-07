const express = require("express");

const router = express.Router();

const participantController = require("../controllers/participantController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const { rateLimit } = require("../middlewares/security");
const requireRegistrationAssignment = require("../middlewares/requireRegistrationAssignment");

router.use(requireAuthentication);
router.use(requireRegistrationAssignment);

router.get("/", rateLimit({ windowMs: 60_000, max: 30 }), participantController.searchParticipants);
router.post("/", participantController.createParticipant);
router.get("/active-consent-form", participantController.getActiveConsentForm);
router.get("/:participantId", participantController.getParticipantById);
router.patch("/:participantId", participantController.updateParticipant);
router.get("/:participantId/registrations", participantController.getParticipantRegistrations);
router.get("/:participantId/consents", participantController.getParticipantConsents);
router.get("/:participantId/emergency-contacts", participantController.getEmergencyContacts);
router.post("/:participantId/emergency-contacts", participantController.addEmergencyContact);
router.patch("/:participantId/emergency-contacts/:contactId", participantController.updateEmergencyContact);
router.post("/:participantId/events/:eventId/consent", participantController.saveConsent);
router.post("/:participantId/consents", participantController.saveConsent);
router.post("/:participantId/consents/:consentId/withdraw", participantController.withdrawConsent);
router.get("/:participantId/events/:eventId/review", participantController.getRegistrationReview);

module.exports = router;
