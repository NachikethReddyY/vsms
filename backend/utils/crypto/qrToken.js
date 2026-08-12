const crypto = require("crypto");

const QR_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Accepts either a bare 64-hex pass token or a full participant-status URL
// (the value a camera scanner actually returns) and normalises it to the
// raw 64-hex token. Returns null when neither shape is recognised.
const extractQrToken = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (QR_TOKEN_PATTERN.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    if (!lastSegment) return null;
    const decoded = decodeURIComponent(lastSegment);
    return QR_TOKEN_PATTERN.test(decoded) ? decoded.toLowerCase() : null;
  } catch {
    return null;
  }
};

// Resolves a scanned or typed QR value to a registration within an event.
// The secure pass table is the only production credential authority.
const resolveRegistrationByQrValue = async (db, { eventId, value }) => {
  if (typeof value !== "string" || !value.trim()) return null;

  const token = extractQrToken(value);
  if (!token) return null;
  return db.qRCodePass.findFirst({
    where: {
      tokenHash: hashToken(token),
      registration: { eventId },
      isActive: true,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { registrationId: true },
  });
};

module.exports = {
  QR_TOKEN_PATTERN,
  hashToken,
  extractQrToken,
  resolveRegistrationByQrValue,
};
