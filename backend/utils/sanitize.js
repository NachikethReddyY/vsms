const REDACTED_KEYS = new Set([
    "password",
    "oldPassword",
    "newPassword",
    "code",
    "mfaCode",
    "accessToken",
    "idToken",
    "refreshToken",
    "signature",
    "signatureObjectKey",
    "signatureSha256",
    "token",
    "qrToken",
]);

function sanitizeMetadata(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (depth > 3) return "[TRUNCATED]";
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
    if (typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            REDACTED_KEYS.has(key) ? "[REDACTED]" : sanitizeMetadata(item, depth + 1),
        ])
    );
}

module.exports = { sanitizeMetadata };
