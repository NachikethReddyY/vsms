const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");
const { createAuditLog } = require("../utils/audit");
const {
    assertUuid,
    cleanString,
    parsePositiveInt,
    validateIdempotencyKey,
} = require("../utils/validation");

const OPEN_EVENT_STATUSES = ["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"];
const REGISTRATION_STATUSES = new Set([
    "REGISTERED",
    "CHECKED_IN",
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
        registrationId: registration.id,
        participantReference: registration.participant.participantReference,
        queueNumber: registration.queueNumber,
        status: registration.registrationStatus,
    };
}

async function auditDuplicate(req, participantId, eventId, registrationId) {
    await createAuditLog({
        userId: req.auth.userId,
        action: "DUPLICATE_REGISTRATION_BLOCKED",
        entityName: "EventRegistration",
        entityId: registrationId,
        outcome: "DENIED",
        newValue: { participantId, eventId },
        context: req.context,
    }).catch(() => {});
}

exports.createRegistration = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.body.participantId, "participantId");
    const eventId = assertUuid(req.params.eventId || req.body.eventId, "eventId");
    const idempotencyKey = validateIdempotencyKey(req.headers["idempotency-key"]);

    const priorRequest = await prisma.eventRegistration.findUnique({
        where: {
            registeredBy_idempotencyKey: {
                registeredBy: req.auth.userId,
                idempotencyKey,
            },
        },
        include: registrationInclude(),
    });
    if (priorRequest) {
        if (priorRequest.participantId !== participantId || priorRequest.eventId !== eventId) {
            const error = new Error("Idempotency key was already used for a different registration");
            error.statusCode = 409;
            throw error;
        }
        return res.status(200).json({
            ...handoff(priorRequest),
            registration: priorRequest,
            idempotentReplay: true,
        });
    }

    const duplicate = await prisma.eventRegistration.findUnique({
        where: { participantId_eventId: { participantId, eventId } },
        select: { id: true },
    });
    if (duplicate) {
        await auditDuplicate(req, participantId, eventId, duplicate.id);
        const error = new Error("Participant is already registered for this event");
        error.statusCode = 409;
        throw error;
    }

    let registration;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            registration = await prisma.$transaction(async (tx) => {
                const [participant, event, acceptedConsent, activeContact] = await Promise.all([
                    tx.participant.findUnique({ where: { id: participantId } }),
                    tx.event.findUnique({ where: { id: eventId } }),
                    tx.participantConsent.findFirst({
                        where: {
                            participantId,
                            eventId,
                            consentStatus: "ACCEPTED",
                            withdrawals: { none: { consentStatus: "WITHDRAWN" } },
                        },
                        orderBy: { createdAt: "desc" },
                    }),
                    tx.participantEmergencyContact.findFirst({
                        where: { participantId, status: "ACTIVE" },
                        select: { id: true },
                    }),
                ]);

                if (!participant || participant.status !== "ACTIVE") {
                    const error = new Error("Active participant not found");
                    error.statusCode = 404;
                    throw error;
                }
                if (!event || !OPEN_EVENT_STATUSES.includes(event.status)) {
                    const error = new Error("Event is not open for registration");
                    error.statusCode = 400;
                    throw error;
                }
                if (!acceptedConsent) {
                    const error = new Error("Accepted, non-withdrawn consent is required before registration");
                    error.statusCode = 400;
                    throw error;
                }
                if (!activeContact) {
                    const error = new Error("An active emergency contact is required before registration");
                    error.statusCode = 400;
                    throw error;
                }

                const aggregate = await tx.eventRegistration.aggregate({
                    where: { eventId },
                    _max: { queueNumber: true },
                });
                const queueNumber = (aggregate._max.queueNumber || 0) + 1;
                const created = await tx.eventRegistration.create({
                    data: {
                        participantId,
                        eventId,
                        queueNumber,
                        registrationStatus: "REGISTERED",
                        registeredBy: req.auth.userId,
                        idempotencyKey,
                    },
                    include: registrationInclude(),
                });
                await tx.registrationStatusHistory.create({
                    data: {
                        registrationId: created.id,
                        fromStatus: null,
                        toStatus: "REGISTERED",
                        changedById: req.auth.userId,
                        reason: "Initial registration",
                    },
                });
                await tx.participantConsent.update({
                    where: { id: acceptedConsent.id },
                    data: { registrationId: created.id },
                });
                await createAuditLog({
                    userId: req.auth.userId,
                    action: "EVENT_REGISTRATION_CREATED",
                    entityName: "EventRegistration",
                    entityId: created.id,
                    newValue: { participantId, eventId, queueNumber, status: "REGISTERED" },
                    context: req.context,
                    client: tx,
                });
                return created;
            }, { isolationLevel: "Serializable" });
            break;
        } catch (error) {
            const target = JSON.stringify(error.meta?.target || "");
            const queueCollision = error.code === "P2034"
                || (error.code === "P2002" && target.includes("queue"));
            if (queueCollision && attempt < 3) continue;

            if (error.code === "P2002" && (target.includes("participant") || target.includes("idempotency"))) {
                const existing = await prisma.eventRegistration.findFirst({
                    where: {
                        OR: [
                            { participantId, eventId },
                            { registeredBy: req.auth.userId, idempotencyKey },
                        ],
                    },
                    include: registrationInclude(),
                });
                if (existing?.participantId === participantId && existing.eventId === eventId && existing.idempotencyKey === idempotencyKey) {
                    return res.status(200).json({
                        ...handoff(existing),
                        registration: existing,
                        idempotentReplay: true,
                    });
                }
                if (existing) await auditDuplicate(req, participantId, eventId, existing.id);
                const duplicateError = new Error("Participant is already registered for this event");
                duplicateError.statusCode = 409;
                throw duplicateError;
            }
            throw error;
        }
    }

    res.status(201).json({
        ...handoff(registration),
        registration,
        idempotentReplay: false,
    });
});

exports.getRegistrationById = asyncHandler(async (req, res) => {
    const registrationId = assertUuid(req.params.registrationId, "registrationId");
    const registration = await prisma.eventRegistration.findUnique({
        where: { id: registrationId },
        include: registrationInclude(),
    });
    if (!registration) {
        const error = new Error("Registration not found");
        error.statusCode = 404;
        throw error;
    }
    res.json({ ...handoff(registration), registration });
});

exports.listEventRegistrations = asyncHandler(async (req, res) => {
    const eventId = assertUuid(req.params.eventId, "eventId");
    const page = parsePositiveInt(req.query.page, 1, 10_000);
    const pageSize = parsePositiveInt(req.query.pageSize, 20, 100);
    const where = { eventId };
    const [total, registrations] = await Promise.all([
        prisma.eventRegistration.count({ where }),
        prisma.eventRegistration.findMany({
            where,
            include: registrationInclude(),
            orderBy: { queueNumber: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
    ]);
    res.json({
        registrations,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
});

exports.getRegistrationHistory = asyncHandler(async (req, res) => {
    const registrationId = assertUuid(req.params.registrationId, "registrationId");
    const history = await prisma.registrationStatusHistory.findMany({
        where: { registrationId },
        orderBy: { occurredAt: "asc" },
        include: {
            changedBy: { select: { id: true, fullName: true } },
        },
    });
    res.json({ history });
});

exports.changeRegistrationStatus = asyncHandler(async (req, res) => {
    const registrationId = assertUuid(req.params.registrationId, "registrationId");
    const toStatus = cleanString(req.body.toStatus, "toStatus", { required: true, max: 30 }).toUpperCase();
    const reason = cleanString(req.body.reason, "reason", { max: 200 });
    if (!REGISTRATION_STATUSES.has(toStatus)) {
        const error = new Error("Registration status is invalid");
        error.statusCode = 400;
        throw error;
    }

    const registration = await prisma.$transaction(async (tx) => {
        const existing = await tx.eventRegistration.findUnique({ where: { id: registrationId } });
        if (!existing) {
            const error = new Error("Registration not found");
            error.statusCode = 404;
            throw error;
        }
        if (existing.registrationStatus === toStatus) {
            const error = new Error("Registration already has that status");
            error.statusCode = 409;
            throw error;
        }
        const updated = await tx.eventRegistration.update({
            where: { id: registrationId },
            data: { registrationStatus: toStatus },
            include: registrationInclude(),
        });
        await tx.registrationStatusHistory.create({
            data: {
                registrationId,
                fromStatus: existing.registrationStatus,
                toStatus,
                changedById: req.auth.userId,
                reason,
            },
        });
        await createAuditLog({
            userId: req.auth.userId,
            action: "REGISTRATION_STATUS_CHANGED",
            entityName: "EventRegistration",
            entityId: registrationId,
            oldValue: { status: existing.registrationStatus },
            newValue: { status: toStatus, reason },
            context: req.context,
            client: tx,
        });
        return updated;
    });
    res.json({ ...handoff(registration), registration });
});
