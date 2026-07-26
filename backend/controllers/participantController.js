const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");
const { createAuditLog } = require("../utils/audit");
const {
    assertUuid,
    cleanString,
    parsePositiveInt,
    validateParticipantPayload,
    validateEmergencyContactPayload,
    validateConsentPayload,
    validationError,
} = require("../utils/validation");

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
        clauses.push({
            OR: [
                { firstName: { contains: name, mode: "insensitive" } },
                { lastName: { contains: name, mode: "insensitive" } },
            ],
        });
    }
    if (contactNumber) clauses.push({ contactNumber: { contains: contactNumber } });
    if (dateOfBirth) {
        const parsed = new Date(`${dateOfBirth}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) throw validationError("dateOfBirth is invalid");
        clauses.push({ dateOfBirth: parsed });
    }
    return { AND: clauses };
}

exports.searchParticipants = asyncHandler(async (req, res) => {
    const where = parseSearch(req);
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

    res.json({
        participants: participants.map(participantPublicSummary),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
});

exports.createParticipant = asyncHandler(async (req, res) => {
    const data = validateParticipantPayload(req.body);
    let participant;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            participant = await prisma.$transaction(async (tx) => {
                const created = await tx.participant.create({
                    data: {
                        ...data,
                        participantReference: participantReference(),
                        emergencyContact: data.contactNumber,
                        consentGiven: false,
                        createdById: req.auth.userId,
                        updatedById: req.auth.userId,
                    },
                });
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
            if (error.code !== "P2002" || attempt === 4) throw error;
        }
    }

    res.status(201).json({ participant });
});

exports.getParticipantById = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
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
    res.json({ participant });
});

exports.updateParticipant = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const updates = validateParticipantPayload(req.body, { partial: true });
    const participant = await prisma.$transaction(async (tx) => {
        const existing = await tx.participant.findUnique({ where: { id: participantId } });
        if (!existing) {
            const error = new Error("Participant not found");
            error.statusCode = 404;
            throw error;
        }

        const updated = await tx.participant.update({
            where: { id: participantId },
            data: { ...updates, updatedById: req.auth.userId },
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
        return updated;
    });

    res.json({ participant });
});

exports.getParticipantRegistrations = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const registrations = await prisma.eventRegistration.findMany({
        where: { participantId },
        include: {
            event: true,
            statusHistory: { orderBy: { occurredAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
    });
    res.json({ registrations: registrations.map(registrationPublicSummary) });
});

exports.getParticipantConsents = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const consents = await prisma.participantConsent.findMany({
        where: { participantId },
        include: {
            consentFormVersion: true,
            event: true,
            withdrawals: true,
        },
        orderBy: { createdAt: "desc" },
    });
    res.json({
        consents: consents.map((consent) => ({
            ...consent,
            event: eventPublicSummary(consent.event),
        })),
    });
});

exports.getEmergencyContacts = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const contacts = await prisma.participantEmergencyContact.findMany({
        where: { participantId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    res.json({ contacts });
});

exports.addEmergencyContact = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const data = validateEmergencyContactPayload(req.body);
    const contact = await prisma.$transaction(async (tx) => {
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
    res.status(201).json({ contact });
});

exports.updateEmergencyContact = asyncHandler(async (req, res) => {
    const contactId = assertUuid(req.params.contactId, "contactId");
    const participantId = req.params.participantId
        ? assertUuid(req.params.participantId, "participantId")
        : null;
    const updates = validateEmergencyContactPayload(req.body, { partial: true });

    const contact = await prisma.$transaction(async (tx) => {
        const existing = await tx.participantEmergencyContact.findUnique({ where: { id: contactId } });
        if (!existing || (participantId && existing.participantId !== participantId)) {
            const error = new Error("Emergency contact not found");
            error.statusCode = 404;
            throw error;
        }
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
    res.json({ contact });
});

exports.getActiveConsentForm = asyncHandler(async (req, res) => {
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
    res.json({ consentForm });
});

exports.saveConsent = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const eventId = assertUuid(req.params.eventId || req.body.eventId, "eventId");
    const data = validateConsentPayload(req.body);
    const now = new Date();

    const consent = await prisma.$transaction(async (tx) => {
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

    res.status(201).json({ consent });
});

exports.withdrawConsent = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const consentId = assertUuid(req.params.consentId, "consentId");
    const withdrawalReason = cleanString(req.body.withdrawalReason, "withdrawalReason", { required: true, max: 1000 });
    const now = new Date();

    const withdrawal = await prisma.$transaction(async (tx) => {
        const original = await tx.participantConsent.findFirst({
            where: { id: consentId, participantId, consentStatus: "ACCEPTED" },
            include: { withdrawals: true },
        });
        if (!original) {
            const error = new Error("Accepted consent record not found");
            error.statusCode = 404;
            throw error;
        }
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

    res.status(201).json({ consent: withdrawal });
});

exports.getRegistrationReview = asyncHandler(async (req, res) => {
    const participantId = assertUuid(req.params.participantId, "participantId");
    const eventId = assertUuid(req.params.eventId, "eventId");
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
    res.json({
        participant,
        event: eventPublicSummary(event),
        emergencyContact,
        latestConsent: consent,
    });
});
