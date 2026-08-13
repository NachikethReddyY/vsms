const REDACTED_KEYS = new Set([
    "password",
    "oldpassword",
    "newpassword",
    "code",
    "mfacode",
    "accesstoken",
    "idtoken",
    "refreshtoken",
    "signature",
    "signatureobjectkey",
    "signaturesha256",
    "token",
    "qrtoken",
    "nric",
    "nationalid",
    "dateofbirth",
    "email",
    "emailaddress",
    "phonenumber",
    "contactnumber",
    "address",
    "firstname",
    "lastname",
    "fullname",
    "participantdisplayname",
]);

const normalizedKey = (key) => String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();

function sanitizeMetadata(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (depth > 3) return "[TRUNCATED]";
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
    if (typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            REDACTED_KEYS.has(normalizedKey(key)) ? "[REDACTED]" : sanitizeMetadata(item, depth + 1),
        ])
    );
}

module.exports = { sanitizeMetadata };
