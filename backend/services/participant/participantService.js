const crypto = require("crypto");
const prisma = require("../../prisma/prismaClient");
const { createAuditLog } = require("../../utils/logging/audit");
const {
    assertUuid,
    cleanNric,
    cleanString,
    maskNric,
    parsePositiveInt,
    validateParticipantPayload,
    validateEmergencyContactPayload,
    validateConsentPayload,
    validationError,
} = require("../../utils/validation/validation");
const { loadVerifiedSignature, consumeSignatureArtifact } = require("../../utils/storage/signatureStorage");
const { assertParticipantEventScope, participantEventScopeWhere } = require("../../utils/validation/participantEventScope");
const {
    nricLookupHash,
    protectParticipantNric,
    revealParticipantNric,
} = require("../../utils/crypto/participantIdentity");

const OPEN_EVENT_STATUSES = ["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"];

function participantReference() {
    return `VSMS-${new Date().getUTCFullYear()}-${String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")}`;
}

function maskPhone(value) {
    const phone = String(value || "");
    return phone.length <= 4 ? "••••" : `${"•".repeat(Math.min(phone.length - 4, 8))}${phone.slice(-4)}`;
}

function maskDate(value) {
    const date = new Date(value);
    return `****-**-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function participantPublicSummary(participant) {
    return {
        id: participant.id,
        participantReference: participant.participantReference,
        firstName: participant.firstName,
        lastName: participant.lastName,
        maskedContactNumber: maskPhone(participant.contactNumber),
        maskedDateOfBirth: maskDate(participant.dateOfBirth),
        status: participant.status,
    };
}

function searchMatchReasons(participant, query) {
    const participantReferenceValue = cleanString(query.participantReference, "participantReference", { max: 30 });
    const name = cleanString(query.name, "name", { max: 100 });
    const contactNumber = cleanString(query.contactNumber, "contactNumber", { max: 30 });
    const dateOfBirth = cleanString(query.dateOfBirth, "dateOfBirth", { max: 10 });
    const reasons = [];

    if (participantReferenceValue && participant.participantReference.toLowerCase().includes(participantReferenceValue.toLowerCase())) {
        reasons.push("Participant reference");
    }
    if (name) {
        const normalizedName = name.toLowerCase();
        const parts = normalizedName.split(/\s+/).filter(Boolean);
        const firstPart = parts[0];
        const remainingParts = parts.slice(1).join(" ");
        const nameMatches = participant.firstName.toLowerCase().includes(normalizedName)
            || participant.lastName.toLowerCase().includes(normalizedName)
            || (Boolean(remainingParts)
                && participant.firstName.toLowerCase().includes(firstPart)
                && participant.lastName.toLowerCase().includes(remainingParts));
        if (nameMatches) reasons.push("Name");
    }
    if (contactNumber && String(participant.contactNumber).includes(contactNumber)) reasons.push("Contact number");
    if (dateOfBirth && new Date(participant.dateOfBirth).toISOString().slice(0, 10) === dateOfBirth) reasons.push("Date of birth");

    return reasons;
}

function eventPublicSummary(event) {
    return {
        ...event,
        id: event.eventId,
        eventName: event.name,
        location: event.venue,
        eventDate: event.startsAt,
        startTime: event.startsAt,
        endTime: event.endsAt,
    };
}

function registrationPublicSummary(registration) {
    return {
        ...registration,
        id: registration.registrationId,
        registeredAt: registration.createdAt,
        event: registration.event ? eventPublicSummary(registration.event) : registration.event,
    };
}

function parseParticipantMatch(payload) {
    const firstName = cleanString(payload.firstName, "firstName", { required: true, max: 100 });
    const lastName = cleanString(payload.lastName, "lastName", { required: true, max: 100 });
    const contactNumber = cleanString(payload.contactNumber, "contactNumber", { required: true, max: 30 });
    const { nric } = cleanNric(payload.nric, { required: true });
    const dateOfBirth = cleanString(payload.dateOfBirth, "dateOfBirth", { required: true, max: 10 });
    const parsedDateOfBirth = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(parsedDateOfBirth.getTime())) throw validationError("dateOfBirth is invalid");
    if (parsedDateOfBirth > new Date()) throw validationError("dateOfBirth cannot be in the future");
    return { firstName, lastName, contactNumber, nric, dateOfBirth, parsedDateOfBirth };
}

function participantMatchReasons(participant, criteria) {
    const reasons = [];
    if (participant.firstName.localeCompare(criteria.firstName, undefined, { sensitivity: "accent" }) === 0
        && participant.lastName.localeCompare(criteria.lastName, undefined, { sensitivity: "accent" }) === 0) {
        reasons.push("Full name");
    }
    if (new Date(participant.dateOfBirth).toISOString().slice(0, 10) === criteria.dateOfBirth) reasons.push("Date of birth");
    if (participant.contactNumber === criteria.contactNumber) reasons.push("Contact number");
    if (revealParticipantNric(participant) === criteria.nric) reasons.push("NRIC / FIN");
    return reasons;
}

function participantPublicDetails(participant) {
    const safeParticipant = { ...participant };
    const { nric, nricMasked } = safeParticipant;
    delete safeParticipant.nric;
    delete safeParticipant.nricMasked;
    delete safeParticipant.nricCiphertext;
    delete safeParticipant.nricLookupHash;
    delete safeParticipant.nricEncryptionVersion;
    return { ...safeParticipant, nricMasked: maskNric(nric) || nricMasked };
}

function assertCrossEventReusePermission(req) {
    if (req.auth?.permissions?.includes("participants:cross-event-reuse")) return;
    const error = new Error("Cross-event participant reuse is not authorized");
    error.statusCode = 403;
    throw error;
}

exports.matchParticipantsForRegistrationService = async (req) => {
    assertCrossEventReusePermission(req);
    const criteria = parseParticipantMatch(req.body || {});
    const fullName = {
        AND: [
            { firstName: { equals: criteria.firstName, mode: "insensitive" } },
            { lastName: { equals: criteria.lastName, mode: "insensitive" } },
        ],
    };
    // A name alone is not enough to classify a participant as a possible duplicate.
    const participants = await prisma.participant.findMany({
        where: {
            OR: [
                { nricLookupHash: nricLookupHash(criteria.nric) },
                { nric: criteria.nric },
                { AND: [fullName, { dateOfBirth: criteria.parsedDateOfBirth }] },
                { AND: [fullName, { contactNumber: criteria.contactNumber }] },
                { AND: [{ dateOfBirth: criteria.parsedDateOfBirth }, { contactNumber: criteria.contactNumber }] },
            ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 10,
        include: {
            eventRegistrations: {
                include: {
                    event: { select: { name: true } },
                    queueEntries: {
                        where: { status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } },
                        include: { station: { select: { stationName: true } } },
                        orderBy: { enteredAt: "desc" },
                        take: 1,
                    },
                },
                orderBy: { createdAt: "desc" },
            },
        },
    });

    const matches = participants.map((participant) => {
        const currentEventRegistration = participant.eventRegistrations.find((registration) => registration.eventId === req.registrationEventId);
        const previousRegistration = participant.eventRegistrations.find((registration) => registration.eventId !== req.registrationEventId);
        const activeQueueEntry = currentEventRegistration?.queueEntries?.[0] ?? null;
        return {
            participant: {
                id: participant.id,
                participantReference: participant.participantReference,
                firstName: participant.firstName,
                lastName: participant.lastName,
                dateOfBirth: participant.dateOfBirth.toISOString().slice(0, 10),
                maskedContactNumber: maskPhone(participant.contactNumber),
                preferredLanguage: participant.preferredLanguage,
            },
            matchReasons: participantMatchReasons(participant, criteria),
            previousEvent: previousRegistration?.event ? { eventName: previousRegistration.event.name } : null,
            currentEventRegistration: currentEventRegistration ? {
                id: currentEventRegistration.registrationId,
                queueNumber: currentEventRegistration.queueNumber,
                status: currentEventRegistration.registrationStatus,
                assignedBooth: activeQueueEntry?.station?.stationName ?? null,
            } : null,
        };
    });

    const response = {
        result: matches.length === 0
            ? "NO_MATCH"
            : matches.every((match) => match.currentEventRegistration)
                ? "ALREADY_REGISTERED"
                : "POSSIBLE_MATCH",
        matches,
    };
    // Cross-event identity data is deliberately limited and every lookup is recorded.
    await createAuditLog({
        userId: req.auth.userId,
        action: "PARTICIPANT_CROSS_EVENT_MATCH_CHECKED",
        entityName: "Event",
        entityId: req.registrationEventId,
        newValue: { matchCount: matches.length, outcome: response.result },
        context: req.context,
    });
    return response;
};

exports.reuseMatchedParticipantService = async (req) => {
    assertCrossEventReusePermission(req);
    const participantId = assertUuid(req.params.participantId, "participantId");
    const criteria = parseParticipantMatch(req.body || {});
    const eventId = req.registrationEventId;

    return prisma.$transaction(async (tx) => {
        const participant = await tx.participant.findUnique({ where: { id: participantId } });
        if (!participant || participant.status !== "ACTIVE") {
            const error = new Error("Active participant not found");
            error.statusCode = 404;
            throw error;
        }

        const matchReasons = participantMatchReasons(participant, criteria);
        if (matchReasons.length < 2 && !matchReasons.includes("NRIC / FIN")) {
            const error = new Error("Participant is not an approved identity match");
            error.statusCode = 403;
            throw error;
        }

        const existingRegistration = await tx.eventRegistration.findUnique({
            where: { participantId_eventId: { participantId, eventId } },
            select: { registrationId: true },
        });
        if (existingRegistration) {
            await createAuditLog({
                userId: req.auth.userId,
                action: "PARTICIPANT_REUSE_ALREADY_REGISTERED",
                entityName: "EventRegistration",
                entityId: existingRegistration.registrationId,
                newValue: { participantId, eventId, matchReasonCount: matchReasons.length },
                context: req.context,
                client: tx,
            });
            return { outcome: "ALREADY_REGISTERED", registrationId: existingRegistration.registrationId };
        }

        const intake = await tx.participantEventIntake.upsert({
            where: { participantId_eventId: { participantId, eventId } },
            update: {},
            create: {
                participantId,
                eventId,
                attachedById: req.auth.userId,
                reason: "REUSED_MATCH",
            },
        });
        await createAuditLog({
            userId: req.auth.userId,
            action: "PARTICIPANT_REUSED_FOR_EVENT",
            entityName: "ParticipantEventIntake",
            entityId: intake.intakeId,
            newValue: { participantId, eventId, matchReasonCount: matchReasons.length },
            context: req.context,
            client: tx,
        });
        return { outcome: "ATTACHED", intakeId: intake.intakeId };
    });
};

function parseSearch(req) {
    const participantReferenceValue = cleanString(req.query.participantReference, "participantReference", { max: 30 });
    const name = cleanString(req.query.name, "name", { max: 100 });
    const contactNumber = cleanString(req.query.contactNumber, "contactNumber", { max: 30 });
    const dateOfBirth = cleanString(req.query.dateOfBirth, "dateOfBirth", { max: 10 });

    if (!participantReferenceValue && !name && !contactNumber && !dateOfBirth) {
        throw validationError("Provide participantReference, name, contactNumber, or dateOfBirth");
    }
    for (const [field, value] of Object.entries({ participantReference: participantReferenceValue, name, contactNumber })) {
        if (value && value.length < 3) throw validationError(`${field} must contain at least 3 characters`);
    }

    const clauses = [];
    if (participantReferenceValue) {
        clauses.push({ participantReference: { contains: participantReferenceValue, mode: "insensitive" } });
    }
    if (name) {
        const parts = name.split(/\s+/).filter(Boolean);
        const firstPart = parts[0];
        const remainingParts = parts.slice(1).join(" ");
        clauses.push({
            OR: [
                { firstName: { contains: name, mode: "insensitive" } },
                { lastName: { contains: name, mode: "insensitive" } },
                ...(remainingParts
                    ? [{
                        AND: [
                            { firstName: { contains: firstPart, mode: "insensitive" } },
                            { lastName: { contains: remainingParts, mode: "insensitive" } },
                        ],
                    }]
                    : []),
            ],
        });
    }
    if (contactNumber) clauses.push({ contactNumber: { contains: contactNumber } });
    if (dateOfBirth) {
        const parsed = new Date(`${dateOfBirth}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) throw validationError("dateOfBirth is invalid");
        clauses.push({ dateOfBirth: parsed });
    }
    return { OR: clauses };
}

exports.searchParticipantsService = async (req) => {
    const where = {
        AND: [
            parseSearch(req),
            participantEventScopeWhere(req.registrationEventId, req.auth.userId),
        ],
    };
    const page = parsePositiveInt(req.query.page, 1, 10_000);
    const pageSize = parsePositiveInt(req.query.pageSize, 10, 50);
    const skip = (page - 1) * pageSize;
    const [total, participants] = await Promise.all([
        prisma.participant.count({ where }),
        prisma.participant.findMany({
            where,
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            skip,
            take: pageSize,
        }),
    ]);

    return {
        participants: participants.map((participant) => ({
            ...participantPublicSummary(participant),
            matchReasons: searchMatchReasons(participant, req.query),
        })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
};

// ==========================================
// Create Participant with Transaction (tx)
// ==========================================
exports.createParticipantService = async (req) => {
    const data = validateParticipantPayload(req.body);
    const participantId = crypto.randomUUID();
    const { nric, ...participantData } = data;
    delete participantData.nricMasked;
    let participant;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            participant = await prisma.$transaction(async (tx) => {
                const created = await tx.participant.create({
                    data: {
                        id: participantId,
                        ...participantData,
                        ...protectParticipantNric(participantId, nric),
                        participantReference: participantReference(),
                        emergencyContact: data.contactNumber,
                        consentGiven: false,
                        createdById: req.auth.userId,
                        updatedById: req.auth.userId,
                        onboardingEventId: req.registrationEventId,
                    },
                });

                // Passing 'tx' to the audit log ensures it rolls back if logging fails
                await createAuditLog({
                    userId: req.auth.userId,
                    action: "PARTICIPANT_CREATED",
                    entityName: "Participant",
                    entityId: created.id,
                    newValue: {
                        participantReference: created.participantReference,
                        status: created.status,
                    },
                    context: req.context,
                    client: tx, 
                });

                return created;
            });
            break;
        } catch (error) {
            // Retry if unique constraint violation occurs on participantReference
            if (error.code !== "P2002" || attempt === 4) throw error;
        }
    }

    return participantPublicDetails(participant);
};

exports.getParticipantByIdService = async (participantIdParam, eventId, userId) => {
    const participantId = await assertParticipantEventScope(prisma, participantIdParam, eventId, userId);
    const participant = await prisma.participant.findUnique({
        where: { id: participantId },
        include: {
            emergencyContacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        },
    });
    if (!participant) {
        const error = new Error("Participant not found");
        error.statusCode = 404;
        throw error;
    }
    return participantPublicDetails(participant);
};

exports.updateParticipantService = async (req) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const updates = validateParticipantPayload(req.body, { partial: true });
    
    return await prisma.$transaction(async (tx) => {
        await assertParticipantEventScope(tx, participantId, req.registrationEventId, req.auth.userId);
        const existing = await tx.participant.findUnique({ where: { id: participantId } });
        if (!existing) {
            const error = new Error("Participant not found");
            error.statusCode = 404;
            throw error;
        }

        const { nric, ...safeUpdates } = updates;
        delete safeUpdates.nricMasked;
        const protectedNric = nric ? protectParticipantNric(participantId, nric) : {};

        const updated = await tx.participant.update({
            where: { id: participantId },
            data: { ...safeUpdates, ...protectedNric, updatedById: req.auth.userId },
        });

        await createAuditLog({
            userId: req.auth.userId,
            action: "PARTICIPANT_UPDATED",
            entityName: "Participant",
            entityId: updated.id,
            oldValue: { status: existing.status },
            newValue: { changedFields: Object.keys(updates), status: updated.status },
            context: req.context,
            client: tx,
        });

        return participantPublicDetails(updated);
    });
};

exports.getParticipantRegistrationsService = async (participantIdParam, eventId, userId) => {
    const participantId = assertUuid(participantIdParam, "participantId");
    await assertParticipantEventScope(prisma, participantId, eventId, userId);
    const registrations = await prisma.eventRegistration.findMany({
        where: { participantId, eventId },
        include: {
            event: true,
            statusHistory: { orderBy: { occurredAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
    });
    return registrations.map(registrationPublicSummary);
};

exports.getParticipantConsentsService = async (participantIdParam, eventId, userId) => {
    const participantId = assertUuid(participantIdParam, "participantId");
    await assertParticipantEventScope(prisma, participantId, eventId, userId);
    const consents = await prisma.participantConsent.findMany({
        where: { participantId, eventId },
        include: {
            consentFormVersion: true,
            event: true,
            withdrawals: true,
        },
        orderBy: { createdAt: "desc" },
    });
    return consents.map((consent) => ({
        ...consent,
        event: eventPublicSummary(consent.event),
    }));
};

exports.getEmergencyContactsService = async (participantIdParam, eventId, userId) => {
    const participantId = await assertParticipantEventScope(prisma, participantIdParam, eventId, userId);
    return await prisma.participantEmergencyContact.findMany({
        where: { participantId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
};

exports.addEmergencyContactService = async (req) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const data = validateEmergencyContactPayload(req.body);
    
    return await prisma.$transaction(async (tx) => {
        await assertParticipantEventScope(tx, participantId, req.registrationEventId, req.auth.userId);
        const participant = await tx.participant.findUnique({ where: { id: participantId }, select: { id: true } });
        if (!participant) {
            const error = new Error("Participant not found");
            error.statusCode = 404;
            throw error;
        }
        if (data.isPrimary) {
            await tx.participantEmergencyContact.updateMany({
                where: { participantId, status: "ACTIVE", isPrimary: true },
                data: { isPrimary: false, updatedById: req.auth.userId },
            });
        }
        const created = await tx.participantEmergencyContact.create({
            data: {
                ...data,
                participantId,
                isPrimary: Boolean(data.isPrimary),
                createdById: req.auth.userId,
                updatedById: req.auth.userId,
            },
        });
        await createAuditLog({
            userId: req.auth.userId,
            action: "EMERGENCY_CONTACT_CREATED",
            entityName: "ParticipantEmergencyContact",
            entityId: created.id,
            newValue: { participantId, isPrimary: created.isPrimary, status: created.status },
            context: req.context,
            client: tx,
        });
        return created;
    });
};

exports.updateEmergencyContactService = async (req) => {
    const contactId = assertUuid(req.params.contactId, "contactId");
    const participantId = req.params.participantId
        ? assertUuid(req.params.participantId, "participantId")
        : null;
    const updates = validateEmergencyContactPayload(req.body, { partial: true });

    return await prisma.$transaction(async (tx) => {
        const existing = await tx.participantEmergencyContact.findUnique({ where: { id: contactId } });
        if (!existing || (participantId && existing.participantId !== participantId)) {
            const error = new Error("Emergency contact not found");
            error.statusCode = 404;
            throw error;
        }
        await assertParticipantEventScope(tx, existing.participantId, req.registrationEventId, req.auth.userId);
        if (updates.isPrimary === true && (updates.status || existing.status) === "ACTIVE") {
            await tx.participantEmergencyContact.updateMany({
                where: {
                    participantId: existing.participantId,
                    status: "ACTIVE",
                    isPrimary: true,
                    NOT: { id: contactId },
                },
                data: { isPrimary: false, updatedById: req.auth.userId },
            });
        }
        if (updates.status === "REMOVED") updates.isPrimary = false;
        const updated = await tx.participantEmergencyContact.update({
            where: { id: contactId },
            data: { ...updates, updatedById: req.auth.userId },
        });
        await createAuditLog({
            userId: req.auth.userId,
            action: "EMERGENCY_CONTACT_UPDATED",
            entityName: "ParticipantEmergencyContact",
            entityId: updated.id,
            oldValue: { isPrimary: existing.isPrimary, status: existing.status },
            newValue: { isPrimary: updated.isPrimary, status: updated.status },
            context: req.context,
            client: tx,
        });
        return updated;
    });
};

exports.getActiveConsentFormService = async () => {
    const now = new Date();
    const consentForm = await prisma.consentFormVersion.findFirst({
        where: {
            isActive: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });
    if (!consentForm) {
        const error = new Error("No active consent form version found");
        error.statusCode = 404;
        throw error;
    }
    return consentForm;
};

exports.saveConsentService = async (req) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const eventId = assertUuid(req.params.eventId || req.body.eventId, "eventId");
    if (eventId !== req.registrationEventId) throw validationError("Event context does not match the consent event");
    const data = validateConsentPayload(req.body);
    const now = new Date();
    if (data.consentStatus === "ACCEPTED") {
        await loadVerifiedSignature(data, req.auth.userId, eventId, "CONSENT");
    }

    return await prisma.$transaction(async (tx) => {
        await assertParticipantEventScope(tx, participantId, eventId, req.auth.userId);
        const [participant, event, consentForm] = await Promise.all([
            tx.participant.findUnique({ where: { id: participantId }, select: { id: true } }),
            tx.event.findUnique({ where: { eventId }, select: { eventId: true, status: true } }),
            tx.consentFormVersion.findFirst({
                where: {
                    id: data.consentFormVersionId,
                    isActive: true,
                    effectiveFrom: { lte: now },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
                },
            }),
        ]);
        if (!participant || !event) {
            const error = new Error("Participant or event not found");
            error.statusCode = 404;
            throw error;
        }
        if (!OPEN_EVENT_STATUSES.includes(event.status)) throw validationError("Event is not open for consent");
        if (!consentForm) throw validationError("The selected consent form is not the current active version");

        const created = await tx.participantConsent.create({
            data: {
                ...data,
                participantId,
                eventId,
                recordedById: req.auth.userId,
                deviceId: req.context.deviceId,
                decisionAt: now,
                signedAt: data.consentStatus === "ACCEPTED" ? now : null,
            },
        });
        if (data.consentStatus === "ACCEPTED") {
            await consumeSignatureArtifact(tx, data, req.auth.userId, eventId, "CONSENT", participantId, now);
            await tx.participant.update({
                where: { id: participantId },
                data: { consentGiven: true, updatedById: req.auth.userId },
            });
        }
        await createAuditLog({
            userId: req.auth.userId,
            action: `CONSENT_${data.consentStatus}`,
            entityName: "ParticipantConsent",
            entityId: created.id,
            newValue: {
                participantId,
                eventId,
                consentFormVersionId: data.consentFormVersionId,
                consentStatus: data.consentStatus,
                signerType: data.signerType,
            },
            context: req.context,
            client: tx,
        });
        return created;
    });
};

exports.withdrawConsentService = async (req) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const consentId = assertUuid(req.params.consentId, "consentId");
    const withdrawalReason = cleanString(req.body.withdrawalReason, "withdrawalReason", { required: true, max: 1000 });
    const now = new Date();

    return await prisma.$transaction(async (tx) => {
        const original = await tx.participantConsent.findFirst({
            where: { id: consentId, participantId, consentStatus: "ACCEPTED" },
            include: { withdrawals: true },
        });
        if (!original) {
            const error = new Error("Accepted consent record not found");
            error.statusCode = 404;
            throw error;
        }
        if (original.eventId !== req.registrationEventId) {
            const error = new Error("Consent is outside the assigned event");
            error.statusCode = 403;
            throw error;
        }
        await assertParticipantEventScope(tx, participantId, original.eventId, req.auth.userId);
        if (original.withdrawals.some((item) => item.consentStatus === "WITHDRAWN")) {
            const error = new Error("Consent has already been withdrawn");
            error.statusCode = 409;
            throw error;
        }

        const created = await tx.participantConsent.create({
            data: {
                participantId,
                eventId: original.eventId,
                registrationId: original.registrationId,
                withdrawalOfId: original.id,
                consentFormVersionId: original.consentFormVersionId,
                consentStatus: "WITHDRAWN",
                signerType: original.signerType,
                signerName: original.signerName,
                signerRelationship: original.signerRelationship,
                recordedById: req.auth.userId,
                deviceId: req.context.deviceId,
                withdrawnAt: now,
                withdrawalReason,
            },
        });
        await createAuditLog({
            userId: req.auth.userId,
            action: "CONSENT_WITHDRAWN",
            entityName: "ParticipantConsent",
            entityId: created.id,
            newValue: { originalConsentId: original.id, participantId, eventId: original.eventId },
            context: req.context,
            client: tx,
        });
        return created;
    });
};

exports.getRegistrationReviewService = async (req) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const eventId = assertUuid(req.params.eventId, "eventId");
    if (eventId !== req.registrationEventId) throw validationError("Event context does not match the registration event");
    await assertParticipantEventScope(prisma, participantId, eventId, req.auth.userId);
    const [participant, event, emergencyContact, consent] = await Promise.all([
        prisma.participant.findUnique({ where: { id: participantId } }),
        prisma.event.findUnique({ where: { eventId } }),
        prisma.participantEmergencyContact.findFirst({
            where: { participantId, status: "ACTIVE" },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        }),
        prisma.participantConsent.findFirst({
            where: { participantId, eventId },
            include: { consentFormVersion: true, withdrawals: true },
            orderBy: { createdAt: "desc" },
        }),
    ]);
    if (!participant || !event) {
        const error = new Error("Participant or event not found");
        error.statusCode = 404;
        throw error;
    }
    return {
        participant,
        event: eventPublicSummary(event),
        emergencyContact,
        latestConsent: consent,
    };
};
