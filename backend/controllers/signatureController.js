const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const asyncHandler = require("../middlewares/asyncHandler");
const { validationError } = require("../utils/validation");

const MIME_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
};

function hasExpectedImageSignature(buffer, mimeType) {
    if (mimeType === "image/png") {
        return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === "image/jpeg") {
        return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
            && buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
    }
    return false;
}

exports.storeSignature = asyncHandler(async (req, res) => {
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

    const signatureSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const filename = `${crypto.randomUUID()}.${MIME_EXTENSIONS[match[1]]}`;
    const storageRoot = path.resolve(
        process.env.SIGNATURE_STORAGE_DIR || path.join(__dirname, "..", "secure-data", "signatures")
    );
    await fs.mkdir(storageRoot, { recursive: true });
    await fs.writeFile(path.join(storageRoot, filename), buffer, { flag: "wx", mode: 0o600 });

    res.status(201).json({
        signatureObjectKey: `signatures/${filename}`,
        signatureSha256,
        signatureMimeType: match[1],
    });
});
