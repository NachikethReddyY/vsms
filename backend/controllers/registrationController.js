const asyncHandler = require("../middlewares/asyncHandler");
const { createAuditLog } = require("../utils/logging/audit");
const {
    assertUuid,
    cleanString,
    parsePositiveInt,
    validateIdempotencyKey,
} = require("../utils/validation/validation");
const { assertRegistrationAssignment } = require("../utils/auth/staff");
const { assertParticipantEventScope } = require("../utils/validation/participantEventScope");
const registrationService = require("../services/participant/registrationService");

const OPEN_EVENT_STATUSES = ["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"];
const REGISTRATION_STATUSES = new Set([
    "SIGNED_UP",
    "CHECKED_IN",
    "COMPLETED",
    "CANCELLED",
]);

function registrationInclude() {
    return {
        event: true,
        participant: {
            select: {
                id: true,
                participantReference: true,
                firstName: true,
                lastName: true,
                dateOfBirth: true,
            },
        },
        statusHistory: { orderBy: { occurredAt: "asc" } },
    };
}

function handoff(registration) {
    return {
        registrationId: registration.registrationId,
        participantReference: registration.participant.participantReference,
        queueNumber: registration.queueNumber,
        status: registration.registrationStatus,
    };
}

function publicRegistration(registration) {
    return {
        ...registration,
        id: registration.registrationId,
        registeredAt: registration.createdAt,
        event: registration.event
            ? {
                ...registration.event,
                id: registration.event.eventId,
                eventName: registration.event.name,
                location: registration.event.venue,
                eventDate: registration.event.startsAt,
                startTime: registration.event.startsAt,
                endTime: registration.event.endsAt,
            }
            : registration.event,
    };
}

exports.createRegistration = asyncHandler(async (req, res) => {
    const result = await registrationService.createRegistration({
        participantId: assertUuid(req.body.participantId, "participantId"),
        eventId: assertUuid(req.params.eventId || req.body.eventId, "eventId"),
        idempotencyKey: validateIdempotencyKey(req.headers["idempotency-key"]),
        auth: req.auth,
        context: req.context,
    });
    res.status(result.idempotentReplay ? 200 : 201).json({
        ...handoff(result.registration),
        registration: publicRegistration(result.registration),
        idempotentReplay: result.idempotentReplay,
    });
});

exports.getRegistrationById = asyncHandler(async (req, res) => {
    const registration = await registrationService.getRegistrationById({
        registrationId: assertUuid(req.params.registrationId, "registrationId"),
        auth: req.auth,
    });
    res.json({ ...handoff(registration), registration: publicRegistration(registration) });
});

exports.listEventRegistrations = asyncHandler(async (req, res) => {
    const result = await registrationService.listEventRegistrations({
        eventId: assertUuid(req.params.eventId, "eventId"),
        page: parsePositiveInt(req.query.page, 1, 10_000),
        pageSize: parsePositiveInt(req.query.pageSize, 20, 100),
        auth: req.auth,
    });
    res.json({ registrations: result.registrations.map(publicRegistration), pagination: result.pagination });
});

exports.getRegistrationHistory = asyncHandler(async (req, res) => {
    const history = await registrationService.getRegistrationHistory({
        registrationId: assertUuid(req.params.registrationId, "registrationId"),
        auth: req.auth,
    });
    res.json({ history });
});

exports.changeRegistrationStatus = asyncHandler(async (req, res) => {
    const registration = await registrationService.changeRegistrationStatus({
        registrationId: assertUuid(req.params.registrationId, "registrationId"),
        toStatus: cleanString(req.body.toStatus, "toStatus", { required: true, max: 30 }).toUpperCase(),
        reason: cleanString(req.body.reason, "reason", { max: 200 }),
        auth: req.auth,
        context: req.context,
    });
    res.json({ ...handoff(registration), registration });
});
