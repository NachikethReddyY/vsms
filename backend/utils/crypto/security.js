const crypto = require("crypto");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const hashUserAgent = (value) => (value ? sha256(value.slice(0, 1000)) : null);

module.exports = { sha256, randomToken, timingSafeEqual, hashUserAgent };
