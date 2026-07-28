const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

// Ensure ENCRYPTION_KEY in .env is 64 hex characters (32 bytes)
// Generate using: crypto.randomBytes(32).toString('hex')
const ENCRYPTION_KEY = Buffer.from(
    process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "hex"
);

/**
 * Encrypt plaintext using AES-256-GCM
 * Output format: iv:authTag:encryptedText
 */
function encrypt(text) {
    if (!text) return text;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    // Return combined payload with delimiters
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt cipher text format (iv:authTag:encryptedText)
 */
function decrypt(cipherPayload) {
    if (!cipherPayload || !cipherPayload.includes(":")) return cipherPayload;

    const parts = cipherPayload.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid encrypted payload format.");
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
}

/**
 * Build a deterministic, keyed lookup value without storing searchable plaintext.
 * This is used for exact duplicate checks; it is not returned by the API.
 */
function lookupHash(text) {
    if (!text) return text;
    return crypto.createHmac("sha256", ENCRYPTION_KEY).update(text, "utf8").digest("hex");
}

module.exports = { encrypt, decrypt, lookupHash };
