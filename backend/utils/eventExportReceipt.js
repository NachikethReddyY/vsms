const crypto = require("crypto");

const DOMAIN = "vsms:event-export-receipt:v1";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
const payloadToSign = (payload) => [
  DOMAIN,
  payload.eventId,
  payload.version,
  payload.actorUserId,
  payload.exportHash,
  payload.expiresAt,
].join(".");
const signatureFor = (payload, secret) => crypto
  .createHmac("sha256", secret)
  .update(payloadToSign(payload))
  .digest("base64url");

const createExportReceipt = ({ eventId, version, actorUserId, exportHash, secret, now = Date.now() }) => {
  const payload = {
    eventId,
    version,
    actorUserId,
    exportHash,
    expiresAt: new Date(now + (15 * 60 * 1000)).toISOString(),
  };
  return `${encode(payload)}.${signatureFor(payload, secret)}`;
};

const same = (left, right) => {
  const leftBytes = Buffer.from(left || "");
  const rightBytes = Buffer.from(right || "");
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
};

const verifyExportReceipt = (receipt, { secret, eventId, version, actorUserId, exportHash, now = Date.now() }) => {
  try {
    const [encodedPayload, signature, ...extra] = String(receipt).split(".");
    if (!encodedPayload || !signature || extra.length) return null;
    const payload = decode(encodedPayload);
    if (
      !same(signature, signatureFor(payload, secret)) ||
      payload.eventId !== eventId ||
      payload.version !== version ||
      payload.actorUserId !== actorUserId ||
      (exportHash !== undefined && payload.exportHash !== exportHash) ||
      !Number.isFinite(Date.parse(payload.expiresAt)) ||
      Date.parse(payload.expiresAt) <= now
    ) return null;
    return payload;
  } catch (_error) {
    return null;
  }
};

module.exports = { createExportReceipt, verifyExportReceipt };
