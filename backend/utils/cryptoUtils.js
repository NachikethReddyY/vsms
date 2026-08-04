const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const env = require("../config/env");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENVELOPE_VERSION = "v2";
const localKeyPath = path.resolve(__dirname, "..", "secure-data", "encryption.key");

const keyBuffer = (key) => {
  const buffer = Buffer.isBuffer(key) ? key : Buffer.from(key, "hex");
  if (buffer.length !== 32) throw new Error("Encryption key must contain exactly 256 bits");
  return buffer;
};

const localKey = () => {
  fs.mkdirSync(path.dirname(localKeyPath), { recursive: true });
  try {
    fs.writeFileSync(localKeyPath, crypto.randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const key = fs.readFileSync(localKeyPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Local encryption key is invalid");
  return key;
};

const configuredKeys = () => {
  if (env.encryptionKeyring) {
    return {
      activeKeyId: env.encryptionActiveKeyId,
      keyring: env.encryptionKeyring,
      legacyKeys: [env.ENCRYPTION_KEY, ...Object.values(env.encryptionKeyring)].filter(Boolean),
    };
  }
  const key = env.ENCRYPTION_KEY || localKey();
  return { activeKeyId: env.ENCRYPTION_KEY ? "legacy-v1" : "local-v1", keyring: { [env.ENCRYPTION_KEY ? "legacy-v1" : "local-v1"]: key }, legacyKeys: [key] };
};

const encryptionContext = (entity, recordId, field) => {
  for (const [label, value] of Object.entries({ entity, recordId, field })) {
    if (typeof value !== "string" || !value.trim() || value.length > 100 || /[|\r\n]/.test(value)) throw new Error(`Invalid encryption context ${label}`);
  }
  return `${entity}|${recordId}|${field}`;
};

const normalizeKeyring = (keyring) => Object.fromEntries(Object.entries(keyring).map(([keyId, key]) => {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error("Invalid encryption key ID");
  return [keyId, keyBuffer(key)];
}));
const aad = (keyId, context) => Buffer.from(`vsms|${ENVELOPE_VERSION}|${keyId}|${context}`, "utf8");

const encryptWithKeyring = (text, context, activeKeyId, keyring) => {
  if (!text) return text;
  if (typeof context !== "string" || !context) throw new Error("Encryption context is required");
  const keys = normalizeKeyring(keyring);
  const key = keys[activeKeyId];
  if (!key) throw new Error("Active encryption key is unavailable");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(aad(activeKeyId, context));
  const ciphertext = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return `${ENVELOPE_VERSION}:${activeKeyId}:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext.toString("hex")}`;
};

const decryptLegacy = (parts, legacyKeys) => {
  if (parts.length !== 3 || !/^[a-f0-9]{24}$/i.test(parts[0]) || !/^[a-f0-9]{32}$/i.test(parts[1]) || !/^[a-f0-9]+$/i.test(parts[2]) || parts[2].length % 2) throw new Error("Invalid legacy encrypted payload format");
  for (const candidate of legacyKeys) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer(candidate), Buffer.from(parts[0], "hex"), { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(Buffer.from(parts[1], "hex"));
      return decipher.update(parts[2], "hex", "utf8") + decipher.final("utf8");
    } catch {
      // Key rotation deliberately tries every configured legacy key without exposing which one failed.
    }
  }
  throw new Error("Encrypted payload authentication failed");
};

const decryptWithKeyring = (cipherPayload, context, keyring, legacyKeys = Object.values(keyring)) => {
  if (!cipherPayload) return cipherPayload;
  if (typeof cipherPayload !== "string") throw new Error("Invalid encrypted payload format");
  const parts = cipherPayload.split(":");
  if (parts[0] !== ENVELOPE_VERSION) return decryptLegacy(parts, legacyKeys);
  if (parts.length !== 5 || !/^[A-Za-z0-9_-]{1,32}$/.test(parts[1]) || !/^[a-f0-9]{24}$/i.test(parts[2]) || !/^[a-f0-9]{32}$/i.test(parts[3]) || !/^[a-f0-9]+$/i.test(parts[4]) || parts[4].length % 2) throw new Error("Invalid encrypted payload format");
  if (typeof context !== "string" || !context) throw new Error("Encryption context is required");
  const [, keyId, ivHex, tagHex, encryptedHex] = parts;
  const key = normalizeKeyring(keyring)[keyId];
  if (!key) throw new Error("Encrypted payload key is unavailable");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"), { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAAD(aad(keyId, context));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(encryptedHex, "hex", "utf8") + decipher.final("utf8");
};

const encrypt = (text, context) => {
  const config = configuredKeys();
  return encryptWithKeyring(text, context, config.activeKeyId, config.keyring);
};

const decrypt = (cipherPayload, context) => {
  const config = configuredKeys();
  return decryptWithKeyring(cipherPayload, context, config.keyring, config.legacyKeys);
};

const ciphertextKeyId = (cipherPayload) => cipherPayload?.startsWith(`${ENVELOPE_VERSION}:`) ? cipherPayload.split(":", 2)[1] : null;
const activeEncryptionKeyId = () => configuredKeys().activeKeyId;

module.exports = {
  encrypt,
  decrypt,
  encryptionContext,
  ciphertextKeyId,
  activeEncryptionKeyId,
  encryptWithKeyring,
  decryptWithKeyring,
};
