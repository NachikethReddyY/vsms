const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");
const { createAuditLog } = require("../utils/audit");

function parsePagination(query) {
    const page = Math.max(Number(query.page || 1), 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize || 10), 1), 50);

    return {
        page,
        pageSize,
        skip: (page - 1) * pageSize,
    };
}

function buildParticipantWhere(query) {
    const clauses = [];

    if (query.name) {
        clauses.push({
            OR: [
                { firstName: { contains: query.name, mode: "insensitive" } },
                { lastName: { contains: query.name, mode: "insensitive" } },
            ],
        });
    }

    if (query.contactNumber) {
        clauses.push({
            contactNumber: {
                contains: query.contactNumber,
            },
        });
    }

    if (query.dateOfBirth) {
        clauses.push({
            dateOfBirth: new Date(query.dateOfBirth),
        });
    }

    if (clauses.length === 0) {
        return {};
    }

    return {
        AND: clauses,
    };
}

exports.searchParticipants = asyncHandler(async (req, res) => {
    if (!req.query.name && !req.query.contactNumber && !req.query.dateOfBirth) {
        return res.status(400).json({
            error: "Provide at least one search field: name, contactNumber, or dateOfBirth",
            requestId: req.context.requestId,
        });
    }

    const pagination = parsePagination(req.query);
    const where = buildParticipantWhere(req.query);

    const [total, participants] = await Promise.all([
        prisma.participant.count({ where }),
        prisma.participant.findMany({
            where,
            include: {
                emergencyContacts: true,
                eventRegistrations: {
                    include: {
                        event: true,
                    },
                    orderBy: {
                        registeredAt: "desc",
                    },
                    take: 5,
                },
            },
            orderBy: {
                updatedAt: "desc",
            },
            skip: pagination.skip,
            take: pagination.pageSize,
        }),
    ]);

    res.json({
        participants,
        pagination: {
            page: pagination.page,
            pageSize: pagination.pageSize,
            total,
        },
    });
});

exports.createParticipant = asyncHandler(async (req, res) => {
    const { firstName, lastName, dateOfBirth, gender, contactNumber, emergencyContact } = req.body;

    if (!firstName || !lastName || !dateOfBirth || !gender || !contactNumber) {
        return res.status(400).json({
            error: "firstName, lastName, dateOfBirth, gender, and contactNumber are required",
            requestId: req.context.requestId,
        });
    }

    const participant = await prisma.participant.create({
        data: {
            firstName,
            lastName,
            dateOfBirth: new Date(dateOfBirth),
            gender,
            contactNumber,
            emergencyContact: emergencyContact || contactNumber,
            consentGiven: false,
        },
    });

    await createAuditLog({
        userId: req.auth.userId,
        action: "PARTICIPANT_CREATED",
        entityName: "Participant",
        entityId: participant.id,
        newValue: participant,
        context: req.context,
    });

    res.status(201).json({
        participant,
    });
});

exports.getParticipantById = asyncHandler(async (req, res) => {
    const participant = await prisma.participant.findUnique({
        where: {
            id: req.params.participantId,
        },
        include: {
            emergencyContacts: true,
            consents: {
                orderBy: {
                    createdAt: "desc",
                },
            },
            eventRegistrations: {
                include: {
                    event: true,
                    statusHistory: {
                        orderBy: {
                            occurredAt: "desc",
                        },
                    },
                },
                orderBy: {
                    registeredAt: "desc",
                },
            },
        },
    });

    if (!participant) {
        return res.status(404).json({
            error: "Participant not found",
            requestId: req.context.requestId,
        });
    }

    res.json({
        participant,
    });
});

exports.updateParticipant = asyncHandler(async (req, res) => {
    const existing = await prisma.participant.findUnique({
        where: {
            id: req.params.participantId,
        },
    });

    if (!existing) {
        return res.status(404).json({
            error: "Participant not found",
            requestId: req.context.requestId,
        });
    }

    const updates = {};
    const allowedFields = [
        "firstName",
        "lastName",
        "gender",
        "contactNumber",
        "emergencyContact",
    ];

    allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    });

    if (req.body.dateOfBirth) {
        updates.dateOfBirth = new Date(req.body.dateOfBirth);
    }

    const participant = await prisma.participant.update({
        where: {
            id: req.params.participantId,
        },
        data: updates,
    });

    await createAuditLog({
        userId: req.auth.userId,
        action: "PARTICIPANT_UPDATED",
        entityName: "Participant",
        entityId: participant.id,
        oldValue: existing,
        newValue: participant,
        context: req.context,
    });

    res.json({
        participant,
    });
});

exports.getParticipantRegistrations = asyncHandler(async (req, res) => {
    const registrations = await prisma.eventRegistration.findMany({
        where: {
            participantId: req.params.participantId,
        },
        include: {
            event: true,
            statusHistory: {
                orderBy: {
                    occurredAt: "desc",
                },
            },
        },
        orderBy: {
            registeredAt: "desc",
        },
    });

    res.json({
        registrations,
    });
});

exports.getParticipantConsents = asyncHandler(async (req, res) => {
    const consents = await prisma.participantConsent.findMany({
        where: {
            participantId: req.params.participantId,
        },
        include: {
            consentFormVersion: true,
            event: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    res.json({
        consents,
    });
});

exports.getEmergencyContacts = asyncHandler(async (req, res) => {
    const contacts = await prisma.participantEmergencyContact.findMany({
        where: {
            participantId: req.params.participantId,
        },
        orderBy: [
            { isPrimary: "desc" },
            { createdAt: "asc" },
        ],
    });

    res.json({
        contacts,
    });
});

exports.addEmergencyContact = asyncHandler(async (req, res) => {
    const { contactName, relationship, phoneNumber, email, isPrimary } = req.body;

    if (!contactName || !relationship || !phoneNumber) {
        return res.status(400).json({
            error: "contactName, relationship, and phoneNumber are required",
            requestId: req.context.requestId,
        });
    }

    if (isPrimary) {
        await prisma.participantEmergencyContact.updateMany({
            where: {
                participantId: req.params.participantId,
                status: "ACTIVE",
            },
            data: {
                isPrimary: false,
            },
        });
    }

    const contact = await prisma.participantEmergencyContact.create({
        data: {
            participantId: req.params.participantId,
            contactName,
            relationship,
            phoneNumber,
            email: email || null,
            isPrimary: Boolean(isPrimary),
            createdById: req.auth.userId,
            updatedById: req.auth.userId,
        },
    });

    await createAuditLog({
        userId: req.auth.userId,
        action: "EMERGENCY_CONTACT_CREATED",
        entityName: "ParticipantEmergencyContact",
        entityId: contact.id,
        newValue: contact,
        context: req.context,
    });

    res.status(201).json({
        contact,
    });
});

exports.updateEmergencyContact = asyncHandler(async (req, res) => {
    const existing = await prisma.participantEmergencyContact.findUnique({
        where: {
            id: req.params.contactId,
        },
    });

    if (!existing || existing.participantId !== req.params.participantId) {
        return res.status(404).json({
            error: "Emergency contact not found",
            requestId: req.context.requestId,
        });
    }

    if (req.body.isPrimary === true) {
        await prisma.participantEmergencyContact.updateMany({
            where: {
                participantId: req.params.participantId,
                status: "ACTIVE",
            },
            data: {
                isPrimary: false,
            },
        });
    }

    const contact = await prisma.participantEmergencyContact.update({
        where: {
            id: req.params.contactId,
        },
        data: {
            contactName: req.body.contactName ?? existing.contactName,
            relationship: req.body.relationship ?? existing.relationship,
            phoneNumber: req.body.phoneNumber ?? existing.phoneNumber,
            email: req.body.email ?? existing.email,
            isPrimary: req.body.isPrimary ?? existing.isPrimary,
            status: req.body.status ?? existing.status,
            updatedById: req.auth.userId,
        },
    });

    await createAuditLog({
        userId: req.auth.userId,
        action: "EMERGENCY_CONTACT_UPDATED",
        entityName: "ParticipantEmergencyContact",
        entityId: contact.id,
        oldValue: existing,
        newValue: contact,
        context: req.context,
    });

    res.json({
        contact,
    });
});

exports.getActiveConsentForm = asyncHandler(async (req, res) => {
    const now = new Date();
    const consentForm = await prisma.consentFormVersion.findFirst({
        where: {
            isActive: true,
            effectiveFrom: {
                lte: now,
            },
            OR: [
                { effectiveTo: null },
                { effectiveTo: { gte: now } },
            ],
        },
        orderBy: [
            { effectiveFrom: "desc" },
            { createdAt: "desc" },
        ],
    });

    if (!consentForm) {
        return res.status(404).json({
            error: "No active consent form version found",
            requestId: req.context.requestId,
        });
    }

    res.json({
        consentForm,
    });
});

exports.saveConsent = asyncHandler(async (req, res) => {
    const { consentFormVersionId, consentStatus, signerName, signerRelationship, signatureObjectKey, signatureSha256, signatureMimeType } = req.body;
    const { participantId, eventId } = req.params;

    if (!consentFormVersionId || !consentStatus) {
        return res.status(400).json({
            error: "consentFormVersionId and consentStatus are required",
            requestId: req.context.requestId,
        });
    }

    const participant = await prisma.participant.findUnique({
        where: {
            id: participantId,
        },
    });

    const event = await prisma.event.findUnique({
        where: {
            id: eventId,
        },
    });

    if (!participant || !event) {
        return res.status(404).json({
            error: "Participant or event not found",
            requestId: req.context.requestId,
        });
    }

    const consent = await prisma.participantConsent.create({
        data: {
            participantId,
            eventId,
            consentFormVersionId,
            consentStatus,
            signerName: signerName || null,
            signerRelationship: signerRelationship || null,
            signatureObjectKey: signatureObjectKey || null,
            signatureSha256: signatureSha256 || null,
            signatureMimeType: signatureMimeType || null,
            recordedById: req.auth.userId,
            deviceId: req.context.deviceId,
            signedAt: consentStatus === "ACCEPTED" ? new Date() : null,
            withdrawalReason: req.body.withdrawalReason || null,
            withdrawnAt: consentStatus === "WITHDRAWN" ? new Date() : null,
        },
    });

    await prisma.participant.update({
        where: {
            id: participantId,
        },
        data: {
            consentGiven: consentStatus === "ACCEPTED",
        },
    });

    await createAuditLog({
        userId: req.auth.userId,
        action: `CONSENT_${consentStatus}`,
        entityName: "ParticipantConsent",
        entityId: consent.id,
        newValue: consent,
        context: req.context,
    });

    res.status(201).json({
        consent,
    });
});

exports.getRegistrationReview = asyncHandler(async (req, res) => {
    const { participantId, eventId } = req.params;

    const [participant, event, contacts, consent] = await Promise.all([
        prisma.participant.findUnique({
            where: {
                id: participantId,
            },
        }),
        prisma.event.findUnique({
            where: {
                id: eventId,
            },
        }),
        prisma.participantEmergencyContact.findMany({
            where: {
                participantId,
                status: "ACTIVE",
            },
            orderBy: {
                isPrimary: "desc",
            },
        }),
        prisma.participantConsent.findFirst({
            where: {
                participantId,
                eventId,
            },
            include: {
                consentFormVersion: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        }),
    ]);

    if (!participant || !event) {
        return res.status(404).json({
            error: "Participant or event not found",
            requestId: req.context.requestId,
        });
    }

    res.json({
        participant,
        event,
        contacts,
        latestConsent: consent,
    });
});
