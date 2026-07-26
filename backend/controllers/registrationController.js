const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");
const { createAuditLog } = require("../utils/audit");

const OPEN_EVENT_STATUSES = ["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"];

exports.createRegistration = asyncHandler(async (req, res) => {
    const { participantId, eventId } = req.body;

    if (!participantId || !eventId) {
        return res.status(400).json({
            error: "participantId and eventId are required",
            requestId: req.context.requestId,
        });
    }

    const registration = await prisma.$transaction(async (tx) => {
        const participant = await tx.participant.findUnique({
            where: {
                id: participantId,
            },
        });

        if (!participant) {
            const error = new Error("Participant not found");
            error.statusCode = 404;
            throw error;
        }

        const event = await tx.event.findUnique({
            where: {
                id: eventId,
            },
        });

        if (!event || !OPEN_EVENT_STATUSES.includes(event.status)) {
            const error = new Error("Event is not open for registration");
            error.statusCode = 400;
            throw error;
        }

        const acceptedConsent = await tx.participantConsent.findFirst({
            where: {
                participantId,
                eventId,
                consentStatus: "ACCEPTED",
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        if (!acceptedConsent) {
            const error = new Error("Accepted consent is required before registration");
            error.statusCode = 400;
            throw error;
        }

        const duplicate = await tx.eventRegistration.findFirst({
            where: {
                participantId,
                eventId,
            },
        });

        if (duplicate) {
            const error = new Error("Participant is already registered for this event");
            error.statusCode = 409;
            throw error;
        }

        const aggregate = await tx.eventRegistration.aggregate({
            where: {
                eventId,
            },
            _max: {
                queueNumber: true,
            },
        });

        const queueNumber = (aggregate._max.queueNumber || 0) + 1;

        const createdRegistration = await tx.eventRegistration.create({
            data: {
                participantId,
                eventId,
                queueNumber,
                registrationStatus: "REGISTERED",
                registeredBy: req.auth.userId,
            },
            include: {
                event: true,
                participant: true,
            },
        });

        await tx.registrationStatusHistory.create({
            data: {
                registrationId: createdRegistration.id,
                fromStatus: null,
                toStatus: "REGISTERED",
                changedById: req.auth.userId,
            },
        });

        await createAuditLog({
            userId: req.auth.userId,
            action: "EVENT_REGISTRATION_CREATED",
            entityName: "EventRegistration",
            entityId: createdRegistration.id,
            newValue: {
                participantId,
                eventId,
                queueNumber,
            },
            context: req.context,
            client: tx,
        });

        return createdRegistration;
    });

    res.status(201).json({
        registration,
    });
});

exports.getRegistrationById = asyncHandler(async (req, res) => {
    const registration = await prisma.eventRegistration.findUnique({
        where: {
            id: req.params.registrationId,
        },
        include: {
            event: true,
            participant: true,
            statusHistory: {
                orderBy: {
                    occurredAt: "desc",
                },
            },
        },
    });

    if (!registration) {
        return res.status(404).json({
            error: "Registration not found",
            requestId: req.context.requestId,
        });
    }

    res.json({
        registration,
    });
});
