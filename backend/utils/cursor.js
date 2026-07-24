const crypto = require("crypto");
const env = require("../config/env");
const AppError = require("../errors/AppError");
const { timingSafeEqual } = require("./security");

const signature = (payload) => crypto.createHmac("sha256", env.jwtAccessSecret).update(payload).digest("base64url");

const encodeCursor = (value) => {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload)}`;
};

const decodeCursor = (cursor, expectedScope) => {
  if (!cursor) return null;
  const [payload, suppliedSignature, extra] = cursor.split(".");
  if (!payload || !suppliedSignature || extra || !timingSafeEqual(signature(payload), suppliedSignature)) {
    throw new AppError(422, "INVALID_CURSOR", "Pagination cursor is invalid");
  }
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (value.scope !== expectedScope) throw new Error("scope mismatch");
    return value;
  } catch (_error) {
    throw new AppError(422, "INVALID_CURSOR", "Pagination cursor is invalid");
  }
};

module.exports = { encodeCursor, decodeCursor };
