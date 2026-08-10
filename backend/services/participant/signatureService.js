const prisma = require("../../prisma/prismaClient");
const { validationError } = require("../../utils/validation");
const { assertRegistrationAssignment } = require("../../utils/staff");
const { assertParticipantEventScope } = require("../../utils/participantEventScope");
const { requireReviewerAccess } = require("../screening/reviewService");
const { storeSignature, deleteSignature } = require("../../utils/signatureStorage");

exports.authorizeSignatureTarget = async ({ eventId, targetId, purpose, auth }, db = prisma) => {
    const eventUser = { ...auth.user, userId: auth.userId };
    if (purpose === "CONSENT") {
        await assertRegistrationAssignment(db, eventId, auth);
        await assertParticipantEventScope(db, targetId, eventId, auth.userId);
        return;
    }
    if (purpose === "REFERRAL") {
        await requireReviewerAccess(db, eventId, eventUser);
        const referral = await db.referral.findFirst({
            where: { referralId: targetId, status: "DRAFT", review: { reviewedByUserId: auth.userId, registration: { eventId } } },
            select: { referralId: true },
        });
        if (!referral) throw validationError("Referral signature target is not available");
        return;
    }
    if (purpose === "REVIEW_DECISION") {
        await requireReviewerAccess(db, eventId, eventUser);
        const registration = await db.eventRegistration.findFirst({
            where: {
                registrationId: targetId,
                eventId,
                registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] },
                reviews: { none: {} },
            },
            select: { registrationId: true },
        });
        if (!registration) throw validationError("Review decision signature target is not available");
        return;
    }
    throw validationError("purpose must be CONSENT, REFERRAL, or REVIEW_DECISION");
};

exports.storeSignature = async ({ eventId, targetId, purpose, buffer, mimeType, auth }, db = prisma) => {
    await exports.authorizeSignatureTarget({ eventId, targetId, purpose, auth }, db);
    const stored = await storeSignature(buffer, mimeType, auth.userId, eventId, purpose);
    try {
        await db.signatureArtifact.create({
            data: {
                ...stored,
                userId: auth.userId,
                eventId,
                purpose,
                targetId,
            },
        });
    } catch (error) {
        await deleteSignature(stored.signatureObjectKey, auth.userId).catch(() => {});
        throw error;
    }
    return stored;
};
