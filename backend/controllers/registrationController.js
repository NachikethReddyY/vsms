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

function registrationEvidence(body, now = new Date()) {
    const paperFormUsed = body.paperFormUsed === true;
    if (body.paperFormUsed !== undefined && typeof body.paperFormUsed !== "boolean") {
        const error = new Error("paperFormUsed must be a boolean");
        error.statusCode = 400;
        throw error;
    }

    const paperExceptionReason = cleanString(body.paperExceptionReason, "paperExceptionReason", { max: 200 });
    if (paperFormUsed !== Boolean(paperExceptionReason)) {
        const error = new Error("A paper exception reason is required only when a paper form was used");
        error.statusCode = 400;
        throw error;
    }
    if (paperExceptionReason && paperExceptionReason.length < 3) {
        const error = new Error("paperExceptionReason must contain at least 3 characters");
        error.statusCode = 400;
        throw error;
    }

    let workflowStartedAt = null;
    if (body.workflowStartedAt !== undefined) {
        workflowStartedAt = new Date(body.workflowStartedAt);
        const ageMs = now.getTime() - workflowStartedAt.getTime();
        if (Number.isNaN(workflowStartedAt.getTime()) || ageMs < -5 * 60_000 || ageMs > 24 * 60 * 60_000) {
            const error = new Error("workflowStartedAt must be a valid time within the last 24 hours");
            error.statusCode = 400;
            throw error;
        }
    }

    return { workflowStartedAt, paperFormUsed, paperExceptionReason: paperExceptionReason || null };
}

exports.createRegistration = asyncHandler(async (req, res) => {
    const evidence = registrationEvidence(req.body);
    const result = await registrationService.createRegistration({
        participantId: assertUuid(req.body.participantId, "participantId"),
        eventId: assertUuid(req.params.eventId || req.body.eventId, "eventId"),
        idempotencyKey: validateIdempotencyKey(req.headers["idempotency-key"]),
        ...evidence,
        auth: req.auth,
        context: req.context,
    });
    res.status(result.idempotentReplay ? 200 : 201).json({
        ...handoff(result.registration),
        registration: publicRegistration(result.registration),
        route: result.route,
        securePass: result.securePass,
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
