const asyncHandler = require("../middlewares/asyncHandler");
const prisma = require("../prisma/prismaClient");
const { assertUuid, cleanString, validationError } = require("../utils/validation");
const { assertRegistrationAssignment } = require("../utils/staff");
const { assertParticipantEventScope } = require("../utils/participantEventScope");
const { requireReviewerAccess } = require("../services/reviewService");
const { MIME_EXTENSIONS, hasExpectedImageSignature, storeSignature, deleteSignature } = require("../utils/signatureStorage");

exports.storeSignature = asyncHandler(async (req, res) => {
    const eventId = assertUuid(req.body?.eventId, "eventId");
    const targetId = assertUuid(req.body?.targetId, "targetId");
    const purpose = cleanString(req.body?.purpose, "purpose", { required: true, max: 20 }).toUpperCase();
    if (purpose === "CONSENT") {
        await assertRegistrationAssignment(prisma, eventId, req.auth);
        await assertParticipantEventScope(prisma, targetId, eventId, req.auth.userId);
    } else if (purpose === "REFERRAL") {
        await requireReviewerAccess(prisma, eventId, req.auth);
        const referral = await prisma.referral.findFirst({
            where: { referralId: targetId, status: "DRAFT", review: { reviewedByUserId: req.auth.userId, registration: { eventId } } },
            select: { referralId: true },
        });
        if (!referral) throw validationError("Referral signature target is not available");
    } else throw validationError("purpose must be CONSENT or REFERRAL");

    const dataUrl = String(req.body?.dataUrl || "");
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match || !MIME_EXTENSIONS[match[1]]) {
        throw validationError("Signature must be a PNG or JPEG data URL");
    }

    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length < 100 || buffer.length > 100_000) {
        throw validationError("Signature image size is invalid");
    }
    if (!hasExpectedImageSignature(buffer, match[1])) {
        throw validationError("Signature image content does not match its MIME type");
    }

    const stored = await storeSignature(buffer, match[1], req.auth.userId, eventId, purpose);
    try {
        await prisma.signatureArtifact.create({ data: {
            ...stored,
            userId: req.auth.userId,
            eventId,
            purpose,
            targetId,
        } });
    } catch (error) {
        await deleteSignature(stored.signatureObjectKey, req.auth.userId).catch(() => {});
        throw error;
    }
    res.status(201).json(stored);
});
