const crypto = require("crypto");
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const env = require("../../config/env");
const AppError = require("../../errors/AppError");

const DATA_URL_PATTERN = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const OBJECT_KEY_PATTERN = /^event-artwork\/([a-f0-9]{64})\.(jpg|webp)$/;
const OBJECT_URI_PATTERN = /^s3:\/\/(event-artwork\/[a-f0-9]{64}\.(?:jpg|webp))$/;
const MAX_BYTES = 140_000;

let defaultClient;
const client = () => {
  defaultClient ??= new S3Client({ region: env.AWS_REGION });
  return defaultClient;
};

const decodeDataUrl = (value) => {
  const match = DATA_URL_PATTERN.exec(value || "");
  if (!match) throw new AppError(422, "INVALID_EVENT_ARTWORK", "Event artwork must be a JPEG or WebP image");
  const contents = Buffer.from(match[2], "base64");
  if (!contents.length || contents.length > MAX_BYTES) {
    throw new AppError(422, "INVALID_EVENT_ARTWORK", "Event artwork is too large");
  }
  return { contents, mimeType: `image/${match[1]}`, extension: match[1] === "jpeg" ? "jpg" : "webp" };
};

const objectKey = (reference) => OBJECT_URI_PATTERN.exec(reference || "")?.[1] || null;
const isStoredArtwork = (reference) => Boolean(objectKey(reference));

const storeArtwork = async (reference, options = {}) => {
  if (reference == null || isStoredArtwork(reference)) return reference;
  const decoded = decodeDataUrl(reference);
  if (!env.eventArtworkBucket) return reference;

  const digest = crypto.createHash("sha256").update(decoded.contents).digest("hex");
  const key = `event-artwork/${digest}.${decoded.extension}`;
  try {
    await (options.client || client()).send(new PutObjectCommand({
      Bucket: env.eventArtworkBucket,
      Key: key,
      Body: decoded.contents,
      ContentType: decoded.mimeType,
      CacheControl: "public, max-age=31536000, immutable",
      ServerSideEncryption: "AES256",
      IfNoneMatch: "*",
    }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 412 && error?.name !== "PreconditionFailed") throw error;
  }
  return `s3://${key}`;
};

const readArtwork = async (reference, options = {}) => {
  if (DATA_URL_PATTERN.test(reference || "")) {
    const { contents, mimeType } = decodeDataUrl(reference);
    return { contents, mimeType, etag: crypto.createHash("sha256").update(contents).digest("hex") };
  }
  const key = objectKey(reference);
  if (!key || !OBJECT_KEY_PATTERN.test(key) || !env.eventArtworkBucket) {
    throw new AppError(404, "EVENT_ARTWORK_NOT_FOUND", "Event artwork was not found");
  }
  try {
    const result = await (options.client || client()).send(new GetObjectCommand({ Bucket: env.eventArtworkBucket, Key: key }));
    const contents = Buffer.from(await result.Body.transformToByteArray());
    if (!contents.length || contents.length > MAX_BYTES) throw new Error("invalid artwork size");
    return {
      contents,
      mimeType: result.ContentType === "image/webp" ? "image/webp" : "image/jpeg",
      etag: String(result.ETag || "").replaceAll('"', "") || crypto.createHash("sha256").update(contents).digest("hex"),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(404, "EVENT_ARTWORK_NOT_FOUND", "Event artwork was not found");
  }
};

const deleteArtwork = async (reference, options = {}) => {
  const key = objectKey(reference);
  if (!key || !env.eventArtworkBucket) return;
  await (options.client || client()).send(new DeleteObjectCommand({ Bucket: env.eventArtworkBucket, Key: key }));
};

module.exports = { DATA_URL_PATTERN, MAX_BYTES, deleteArtwork, isStoredArtwork, objectKey, readArtwork, storeArtwork };
