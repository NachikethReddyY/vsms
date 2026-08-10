const asyncHandler = require("../middlewares/asyncHandler");
const signatureService = require("../services/participant/signatureService");
const { assertUuid, cleanString, validationError } = require("../utils/validation");
const { MIME_EXTENSIONS, hasExpectedImageSignature } = require("../utils/signatureStorage");

exports.storeSignature = asyncHandler(async (req, res) => {
    const eventId = assertUuid(req.body?.eventId, "eventId");
    const targetId = assertUuid(req.body?.targetId, "targetId");
    const purpose = cleanString(req.body?.purpose, "purpose", { required: true, max: 20 }).toUpperCase();
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ""));
    if (!match || !MIME_EXTENSIONS[match[1]]) throw validationError("Signature must be a PNG or JPEG data URL");

    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length < 100 || buffer.length > 100_000) throw validationError("Signature image size is invalid");
    if (!hasExpectedImageSignature(buffer, match[1])) {
        throw validationError("Signature image content does not match its MIME type");
    }

    const stored = await signatureService.storeSignature({
        eventId,
        targetId,
        purpose,
        buffer,
        mimeType: match[1],
        auth: req.auth,
    });
    res.status(201).json(stored);
});
