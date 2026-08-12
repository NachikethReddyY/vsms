const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const AppError = require("../../errors/AppError");

const MIME_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg" };
const PURPOSE_SLUGS = Object.freeze({
  CONSENT: "consent",
  REFERRAL: "referral",
  REVIEW_DECISION: "review-decision",
});
const SIGNATURE_KEY = /^signatures\/([a-f0-9-]{36})\/(consent|referral|review-decision)-([a-f0-9-]{36})-([a-f0-9-]{36})\.(png|jpg)$/;
const storageRoot = () => path.resolve(
  process.env.SIGNATURE_STORAGE_DIR || path.join(__dirname, "..", "..", "secure-data", "signatures"),
);

const signatureMetadata = (signatureObjectKey, expectedEventId = null, expectedUserId = null) => {
  const match = SIGNATURE_KEY.exec(signatureObjectKey || "");
  if (!match || (expectedEventId && match[3] !== expectedEventId) || (expectedUserId && match[1] !== expectedUserId)) {
    throw new AppError(422, "INVALID_SIGNATURE", "Signature metadata is invalid");
  }
  const root = storageRoot();
  const filePath = path.resolve(root, match[1], `${match[2]}-${match[3]}-${match[4]}.${match[5]}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new AppError(422, "INVALID_SIGNATURE", "Signature metadata is invalid");
  }
  return { userId: match[1], purpose: match[2], eventId: match[3], filePath };
};

const hasExpectedImageSignature = (buffer, mimeType) => mimeType === "image/png"
  ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  : mimeType === "image/jpeg"
    && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    && buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]));

const storeSignature = async (buffer, mimeType, userId, eventId, purpose) => {
  const purposeSlug = PURPOSE_SLUGS[purpose];
  if (!purposeSlug) throw new AppError(422, "INVALID_SIGNATURE", "Signature purpose is invalid");
  const filename = `${purposeSlug}-${eventId}-${crypto.randomUUID()}.${MIME_EXTENSIONS[mimeType]}`;
  const userRoot = path.join(storageRoot(), userId);
  await fs.mkdir(userRoot, { recursive: true });
  await fs.writeFile(path.join(userRoot, filename), buffer, { flag: "wx", mode: 0o600 });
  return {
    signatureObjectKey: `signatures/${userId}/${filename}`,
    signatureSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    signatureMimeType: mimeType,
  };
};

const loadVerifiedSignature = async ({ signatureObjectKey, signatureSha256, signatureMimeType }, userId, eventId, purpose) => {
  const extension = MIME_EXTENSIONS[signatureMimeType];
  const purposeSlug = PURPOSE_SLUGS[purpose];
  const match = SIGNATURE_KEY.exec(signatureObjectKey || "");
  if (!extension || !purposeSlug || !match || match[1] !== userId || match[2] !== purposeSlug || match[3] !== eventId || match[5] !== extension) {
    throw new AppError(422, "INVALID_SIGNATURE", "Signature metadata is invalid");
  }
  let buffer;
  try {
    buffer = await fs.readFile(path.join(storageRoot(), match[1], `${match[2]}-${match[3]}-${match[4]}.${match[5]}`));
  } catch (error) {
    if (error.code === "ENOENT") throw new AppError(422, "INVALID_SIGNATURE", "Signature image is unavailable");
    throw error;
  }
  const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const expectedHash = String(signatureSha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)
      || !crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"))
      || !hasExpectedImageSignature(buffer, signatureMimeType)) {
    throw new AppError(422, "INVALID_SIGNATURE", "Signature image could not be verified");
  }
  return buffer;
};

const consumeSignatureArtifact = async (db, { signatureObjectKey, signatureSha256, signatureMimeType }, userId, eventId, purpose, targetId, consumedAt = new Date()) => {
  const consumed = await db.signatureArtifact.updateMany({
    where: {
      signatureObjectKey,
      signatureSha256: String(signatureSha256 || "").toLowerCase(),
      signatureMimeType,
      userId,
      eventId,
      purpose,
      targetId,
      consumedAt: null,
    },
    data: { consumedAt },
  });
  if (consumed.count !== 1) throw new AppError(409, "SIGNATURE_ALREADY_USED", "Signature is unavailable, bound to another record, or already used");
};

const deleteSignature = async (signatureObjectKey, userId) => {
  const { filePath } = signatureMetadata(signatureObjectKey, null, userId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new AppError(422, "INVALID_SIGNATURE", "Signature image is unavailable or already used");
    throw error;
  }
};

const deleteEventSignature = async (signatureObjectKey, eventId) => {
  const { filePath } = signatureMetadata(signatureObjectKey, eventId);
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new AppError(409, "UNSAFE_ARTIFACT_PATH", "Signature artifact is not a regular file");
    }
    await fs.unlink(filePath);
  } catch (error) {
    // Cleanup is idempotent: a missing artifact is already in the desired state.
    if (error.code === "ENOENT") return false;
    throw error;
  }
  return true;
};

module.exports = {
  MIME_EXTENSIONS,
  PURPOSE_SLUGS,
  hasExpectedImageSignature,
  storeSignature,
  loadVerifiedSignature,
  consumeSignatureArtifact,
  deleteSignature,
  deleteEventSignature,
  signatureMetadata,
};
