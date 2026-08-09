const asyncHandler = require("../middlewares/asyncHandler");
const participantService = require("../services/participant/participantService");

exports.searchParticipants = asyncHandler(async (req, res) => {
    const result = await participantService.searchParticipantsService(req);
    res.json(result);
});

exports.matchParticipantsForRegistration = asyncHandler(async (req, res) => {
    const result = await participantService.matchParticipantsForRegistrationService(req);
    res.json(result);
});

exports.reuseMatchedParticipant = asyncHandler(async (req, res) => {
    const result = await participantService.reuseMatchedParticipantService(req);
    res.json(result);
});

exports.createParticipant = asyncHandler(async (req, res) => {
    const participant = await participantService.createParticipantService(req);
    res.status(201).json({ participant });
});

exports.getParticipantById = asyncHandler(async (req, res) => {
    const participant = await participantService.getParticipantByIdService(req.params.participantId, req.registrationEventId, req.auth.userId);
    res.json({ participant });
});

exports.updateParticipant = asyncHandler(async (req, res) => {
    const participant = await participantService.updateParticipantService(req);
    res.json({ participant });
});

exports.getParticipantRegistrations = asyncHandler(async (req, res) => {
    const registrations = await participantService.getParticipantRegistrationsService(req.params.participantId, req.registrationEventId, req.auth.userId);
    res.json({ registrations });
});

exports.getParticipantConsents = asyncHandler(async (req, res) => {
    const consents = await participantService.getParticipantConsentsService(req.params.participantId, req.registrationEventId, req.auth.userId);
    res.json({ consents });
});

exports.getEmergencyContacts = asyncHandler(async (req, res) => {
    const contacts = await participantService.getEmergencyContactsService(req.params.participantId, req.registrationEventId, req.auth.userId);
    res.json({ contacts });
});

exports.addEmergencyContact = asyncHandler(async (req, res) => {
    const contact = await participantService.addEmergencyContactService(req);
    res.status(201).json({ contact });
});

exports.updateEmergencyContact = asyncHandler(async (req, res) => {
    const contact = await participantService.updateEmergencyContactService(req);
    res.json({ contact });
});

exports.getActiveConsentForm = asyncHandler(async (req, res) => {
    const consentForm = await participantService.getActiveConsentFormService();
    res.json({ consentForm });
});

exports.saveConsent = asyncHandler(async (req, res) => {
    const consent = await participantService.saveConsentService(req);
    res.status(201).json({ consent });
});

exports.withdrawConsent = asyncHandler(async (req, res) => {
    const withdrawal = await participantService.withdrawConsentService(req);
    res.status(201).json({ consent: withdrawal });
});

exports.getRegistrationReview = asyncHandler(async (req, res) => {
    const review = await participantService.getRegistrationReviewService(req);
    res.json(review);
});
