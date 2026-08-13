const prisma = require("../../prisma/prismaClient");
const { createAuditLog } = require("../../utils/logging/audit");
const { assertRegistrationAssignment } = require("../../utils/auth/staff");
const { assertParticipantEventScope } = require("../../utils/validation/participantEventScope");
const qrService = require("./qrService");
const {
    assignRouteOnce,
    getRouteState,
} = require("../screening/routeAssignmentService");

const REGISTRATION_STATUSES = new Set(["SIGNED_UP", "WAITLISTED", "CHECKED_IN", "COMPLETED", "CANCELLED"]);

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

const routineErrors = {
    REGISTRATION_EVENT_NOT_FOUND: [404, "Event not found"],
    REGISTRATION_EVENT_NOT_OPEN: [400, "Event is not open for registration"],
    REGISTRATION_CONSENT_REQUIRED: [400, "Consent acknowledgement is required before registration"],
    REGISTRATION_PARTICIPANT_NOT_ACTIVE: [404, "Active participant not found"],
    REGISTRATION_EMERGENCY_CONTACT_REQUIRED: [400, "An active emergency contact is required before registration"],
    REGISTRATION_DUPLICATE: [409, "Participant is already registered for this event"],
    REGISTRATION_IDEMPOTENCY_CONFLICT: [409, "Idempotency key was already used for a different registration"],
    REGISTRATION_NOT_FOUND: [404, "Registration not found"],
    REGISTRATION_CANNOT_BE_CANCELLED: [409, "Only signed-up or waitlisted registrations can be cancelled"],
    REGISTRATION_CHECKIN_CONFLICT: [409, "Only a signed-up participant can be checked in"],
};

function mapRoutineError(error) {
    const routineCode = Object.keys(routineErrors).find((code) => String(error?.message || "").includes(code));
    const entry = routineErrors[routineCode];
    if (!entry) return error;
    const mapped = new Error(entry[1]);
    mapped.statusCode = entry[0];
    return mapped;
}

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

async function provisionExistingRegistration({ registration, userId, eventId, context, db }) {
    if (registration.registrationStatus === "WAITLISTED") {
        return { registration, route: null, securePass: null };
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            return await db.$transaction(async (tx) => {
                const securePass = await qrService.generateQR(registration.registrationId, userId, tx, context);
                const route = registration.event.status === "IN_PROGRESS" && registration.checkedIn
                    ? await assignRouteOnce({
                        tx,
                        registrationId: registration.registrationId,
                        eventId,
                        actorUserId: userId,
                        context,
                    })
                    : await getRouteState(tx, registration.registrationId, false);
                const current = await tx.eventRegistration.findUnique({
                    where: { registrationId: registration.registrationId },
                    include: registrationInclude(),
                });
                return { registration: current, route, securePass };
            }, { isolationLevel: "ReadCommitted" });
        } catch (error) {
            if (error.code === "P2034" && attempt < 3) continue;
            throw error;
        }
    }
    throw conflict("Unable to provision registration. Please retry.");
}

exports.createRegistration = async ({ participantId, eventId, consentAcknowledged, idempotencyKey, auth, context }, db = prisma) => {
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
        const provisioning = await provisionExistingRegistration({
            registration: priorRequest,
            userId,
            eventId,
            context,
            db,
        });
        return { ...provisioning, idempotentReplay: true };
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
                const rows = await tx.$queryRaw`
                    SELECT * FROM "register_participant_for_event"(
                        CAST(${participantId} AS uuid),
                        CAST(${eventId} AS uuid),
                        CAST(${userId} AS uuid),
                        ${idempotencyKey},
                        ${consentAcknowledged}
                    )
                `;
                const operation = rows[0];
                const created = await tx.eventRegistration.findUnique({
                    where: { registrationId: operation.registration_id },
                    include: registrationInclude(),
                });
                if (!operation.idempotent_replay) {
                    await createAuditLog({
                        userId,
                        action: "EVENT_REGISTRATION_CREATED",
                        entityName: "EventRegistration",
                        entityId: created.registrationId,
                        newValue: { participantId, eventId, queueNumber: null, status: created.registrationStatus, consentAcknowledged: true },
                        context,
                        client: tx,
                    });
                }
                const securePass = created.registrationStatus === "WAITLISTED"
                    ? null
                    : await qrService.generateQR(created.registrationId, userId, tx, context);
                const route = created.registrationStatus === "WAITLISTED"
                    ? null
                    : created.event.status === "IN_PROGRESS"
                    ? await assignRouteOnce({
                        tx,
                        registrationId: created.registrationId,
                        eventId,
                        actorUserId: userId,
                        context,
                    })
                    : await getRouteState(tx, created.registrationId, false);
                const current = await tx.eventRegistration.findUnique({
                    where: { registrationId: created.registrationId },
                    include: registrationInclude(),
                });
                return { registration: current, route, securePass, idempotentReplay: operation.idempotent_replay === true };
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
                    const provisioning = await provisionExistingRegistration({
                        registration: existing,
                        userId,
                        eventId,
                        context,
                        db,
                    });
                    return { ...provisioning, idempotentReplay: true };
                }
                if (existing) await auditDuplicate({ userId, context, participantId, eventId, registrationId: existing.registrationId });
                throw conflict("Participant is already registered for this event");
            }
            throw mapRoutineError(error);
        }
    }

    return { ...registration, idempotentReplay: registration.idempotentReplay === true };
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

exports.getEventRegistrationSummary = async ({ eventId, auth }, db = prisma) => {
    await assertRegistrationAssignment(db, eventId, auth);
    const rows = await db.$queryRaw`
        SELECT * FROM "get_event_registration_summary"(CAST(${eventId} AS uuid))
    `;
    if (!rows[0]) throw notFound("Event not found");
    return rows[0];
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

    if (toStatus === "CANCELLED") {
        const existing = await db.eventRegistration.findUnique({ where: { registrationId }, select: { eventId: true, registrationStatus: true } });
        if (!existing) throw notFound("Registration not found");
        await assertRegistrationAssignment(db, existing.eventId, auth);

        let promotedRegistrationId = null;
        const cancelled = await db.$transaction(async (tx) => {
            const rows = await tx.$queryRaw`
                SELECT * FROM "cancel_event_registration"(
                    CAST(${registrationId} AS uuid),
                    CAST(${auth.userId} AS uuid),
                    ${reason || null}
                )
            `;
            promotedRegistrationId = rows[0]?.promoted_registration_id || null;
            const registration = await tx.eventRegistration.findUnique({ where: { registrationId }, include: registrationInclude() });
            await createAuditLog({
                userId: auth.userId,
                action: "REGISTRATION_STATUS_CHANGED",
                entityName: "EventRegistration",
                entityId: registrationId,
                oldValue: { status: existing.registrationStatus },
                newValue: { status: "CANCELLED", reason },
                context,
                client: tx,
            });
            if (promotedRegistrationId) {
                await createAuditLog({
                    userId: auth.userId,
                    action: "REGISTRATION_WAITLIST_PROMOTED",
                    entityName: "EventRegistration",
                    entityId: promotedRegistrationId,
                    newValue: { status: "SIGNED_UP", promotedByCancellationOf: registrationId },
                    context,
                    client: tx,
                });
            }
            return registration;
        }, { isolationLevel: "Serializable" }).catch((error) => { throw mapRoutineError(error); });

        if (promotedRegistrationId) {
            const promoted = await db.eventRegistration.findUnique({ where: { registrationId: promotedRegistrationId }, include: registrationInclude() });
            await provisionExistingRegistration({ registration: promoted, userId: auth.userId, eventId: promoted.eventId, context, db });
        }
        return cancelled;
    }

    if (toStatus === "WAITLISTED") throw conflict("Waitlist status is assigned automatically when an event is full");

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
