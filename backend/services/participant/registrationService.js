const prisma = require("../../prisma/prismaClient");
const { createAuditLog } = require("../../utils/logging/audit");
const { assertRegistrationAssignment } = require("../../utils/auth/staff");
const { assertParticipantEventScope } = require("../../utils/validation/participantEventScope");

const OPEN_EVENT_STATUSES = ["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"];
const REGISTRATION_STATUSES = new Set(["SIGNED_UP", "CHECKED_IN", "COMPLETED", "CANCELLED"]);

const registrationInclude = () => ({
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
});

const notFound = (message) => {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
};

const conflict = (message) => {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
};

async function auditDuplicate({ userId, context, participantId, eventId, registrationId }) {
    await createAuditLog({
        userId,
        action: "DUPLICATE_REGISTRATION_BLOCKED",
        entityName: "EventRegistration",
        entityId: registrationId,
        outcome: "DENIED",
        newValue: { participantId, eventId },
        context,
    }).catch(() => {});
}

exports.createRegistration = async ({ participantId, eventId, idempotencyKey, auth, context }, db = prisma) => {
    const userId = auth.userId;
    await assertRegistrationAssignment(db, eventId, auth);

    const priorRequest = await db.eventRegistration.findUnique({
        where: { registeredBy_idempotencyKey: { registeredBy: userId, idempotencyKey } },
        include: registrationInclude(),
    });
    if (priorRequest) {
        if (priorRequest.participantId !== participantId || priorRequest.eventId !== eventId) {
            throw conflict("Idempotency key was already used for a different registration");
        }
        return { registration: priorRequest, idempotentReplay: true };
    }

    const duplicate = await db.eventRegistration.findUnique({
        where: { participantId_eventId: { participantId, eventId } },
        select: { registrationId: true },
    });
    if (duplicate) {
        await auditDuplicate({ userId, context, participantId, eventId, registrationId: duplicate.registrationId });
        throw conflict("Participant is already registered for this event");
    }

    let registration;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            registration = await db.$transaction(async (tx) => {
                await assertParticipantEventScope(tx, participantId, eventId, userId);
                const [participant, event, acceptedConsent, activeContact] = await Promise.all([
                    tx.participant.findUnique({ where: { id: participantId } }),
                    tx.event.findUnique({ where: { eventId } }),
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

                if (!participant || participant.status !== "ACTIVE") throw notFound("Active participant not found");
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

                const created = await tx.eventRegistration.create({
                    data: {
                        participantId,
                        eventId,
                        registrationStatus: "SIGNED_UP",
                        registeredBy: userId,
                        idempotencyKey,
                    },
                    include: registrationInclude(),
                });
                await tx.registrationStatusHistory.create({
                    data: {
                        registrationId: created.registrationId,
                        fromStatus: null,
                        toStatus: "SIGNED_UP",
                        changedById: userId,
                        reason: "Initial registration",
                    },
                });
                await tx.participantConsent.update({
                    where: { id: acceptedConsent.id },
                    data: { registrationId: created.registrationId },
                });
                await createAuditLog({
                    userId,
                    action: "EVENT_REGISTRATION_CREATED",
                    entityName: "EventRegistration",
                    entityId: created.registrationId,
                    newValue: { participantId, eventId, queueNumber: null, status: "SIGNED_UP" },
                    context,
                    client: tx,
                });
                return created;
            }, { isolationLevel: "Serializable" });
            break;
        } catch (error) {
            const target = JSON.stringify(error.meta?.target || "");
            const queueCollision = error.code === "P2034" || (error.code === "P2002" && target.includes("queue"));
            if (queueCollision && attempt < 3) continue;

            if (error.code === "P2002" && (target.includes("participant") || target.includes("idempotency"))) {
                const existing = await db.eventRegistration.findFirst({
                    where: { OR: [{ participantId, eventId }, { registeredBy: userId, idempotencyKey }] },
                    include: registrationInclude(),
                });
                if (existing?.participantId === participantId && existing.eventId === eventId && existing.idempotencyKey === idempotencyKey) {
                    return { registration: existing, idempotentReplay: true };
                }
                if (existing) await auditDuplicate({ userId, context, participantId, eventId, registrationId: existing.registrationId });
                throw conflict("Participant is already registered for this event");
            }
            throw error;
        }
    }

    return { registration, idempotentReplay: false };
};

exports.getRegistrationById = async ({ registrationId, auth }, db = prisma) => {
    const registration = await db.eventRegistration.findUnique({ where: { registrationId }, include: registrationInclude() });
    if (!registration) throw notFound("Registration not found");
    await assertRegistrationAssignment(db, registration.eventId, auth);
    return registration;
};

exports.listEventRegistrations = async ({ eventId, page, pageSize, auth }, db = prisma) => {
    await assertRegistrationAssignment(db, eventId, auth);
    const where = { eventId };
    const [total, registrations] = await Promise.all([
        db.eventRegistration.count({ where }),
        db.eventRegistration.findMany({
            where,
            include: registrationInclude(),
            orderBy: { queueNumber: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
    ]);
    return { registrations, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
};

exports.getRegistrationHistory = async ({ registrationId, auth }, db = prisma) => {
    const registration = await db.eventRegistration.findUnique({ where: { registrationId }, select: { eventId: true } });
    if (!registration) throw notFound("Registration not found");
    await assertRegistrationAssignment(db, registration.eventId, auth);
    return db.registrationStatusHistory.findMany({
        where: { registrationId },
        orderBy: { occurredAt: "asc" },
        include: { changedBy: { select: { id: true, fullName: true } } },
    });
};

exports.changeRegistrationStatus = async ({ registrationId, toStatus, reason, auth, context }, db = prisma) => {
    if (!REGISTRATION_STATUSES.has(toStatus)) {
        const error = new Error("Registration status is invalid");
        error.statusCode = 400;
        throw error;
    }

    return db.$transaction(async (tx) => {
        const existing = await tx.eventRegistration.findUnique({ where: { registrationId } });
        if (!existing) throw notFound("Registration not found");
        await assertRegistrationAssignment(tx, existing.eventId, auth);
        if (existing.registrationStatus === toStatus) throw conflict("Registration already has that status");
        const updated = await tx.eventRegistration.update({
            where: { registrationId },
            data: { registrationStatus: toStatus },
            include: registrationInclude(),
        });
        await tx.registrationStatusHistory.create({
            data: {
                registrationId,
                fromStatus: existing.registrationStatus,
                toStatus,
                changedById: auth.userId,
                reason,
            },
        });
        await createAuditLog({
            userId: auth.userId,
            action: "REGISTRATION_STATUS_CHANGED",
            entityName: "EventRegistration",
            entityId: registrationId,
            oldValue: { status: existing.registrationStatus },
            newValue: { status: toStatus, reason },
            context,
            client: tx,
        });
        return updated;
    });
};
