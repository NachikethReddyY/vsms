const { validate: isUuid } = require("uuid");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,19}$/;
const GENDERS = new Set(["M", "F", "O", "U"]);
const PARTICIPANT_STATUSES = new Set(["ACTIVE", "INACTIVE", "DECEASED"]);
const CONTACT_STATUSES = new Set(["ACTIVE", "REMOVED"]);
const CONSENT_STATUSES = new Set(["ACCEPTED", "DECLINED"]);
const SIGNER_TYPES = new Set(["PARTICIPANT", "PARENT", "GUARDIAN", "AUTHORISED_REPRESENTATIVE"]);

function validationError(message, details = null) {
    const error = new Error(message);
    error.statusCode = 400;
    error.details = details;
    return error;
}

function assertUuid(value, fieldName) {
    if (!isUuid(String(value || ""))) {
        throw validationError(`${fieldName} must be a valid UUID`);
    }
    return String(value);
}

function cleanString(value, fieldName, { required = false, max = 255 } = {}) {
    if (value === undefined || value === null) {
        if (required) throw validationError(`${fieldName} is required`);
        return null;
    }

    const cleaned = String(value).trim();
    if (required && !cleaned) throw validationError(`${fieldName} is required`);
    if (!cleaned) return null;
    if (cleaned.length > max) throw validationError(`${fieldName} must be ${max} characters or fewer`);
    return cleaned;
}

function cleanEmail(value, fieldName = "email") {
    const email = cleanString(value, fieldName, { max: 255 });
    if (email && !EMAIL_PATTERN.test(email)) throw validationError(`${fieldName} is invalid`);
    return email ? email.toLowerCase() : null;
}

function cleanPhone(value, fieldName, required = false) {
    const phone = cleanString(value, fieldName, { required, max: 30 });
    if (phone && !PHONE_PATTERN.test(phone)) throw validationError(`${fieldName} is invalid`);
    return phone;
}

function cleanDateOfBirth(value) {
    const raw = cleanString(value, "dateOfBirth", { required: true, max: 10 });
    const date = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw validationError("dateOfBirth is invalid");
    if (date > new Date()) throw validationError("dateOfBirth cannot be in the future");
    if (date.getUTCFullYear() < 1900) throw validationError("dateOfBirth is outside the supported range");
    return date;
}

function validateParticipantPayload(payload, { partial = false } = {}) {
    const result = {};
    const has = (field) => Object.prototype.hasOwnProperty.call(payload, field);

    if (!partial || has("firstName")) result.firstName = cleanString(payload.firstName, "firstName", { required: true, max: 100 });
    if (!partial || has("lastName")) result.lastName = cleanString(payload.lastName, "lastName", { required: true, max: 100 });
    if (!partial || has("dateOfBirth")) result.dateOfBirth = cleanDateOfBirth(payload.dateOfBirth);

    if (!partial || has("gender")) {
        const gender = cleanString(payload.gender, "gender", { required: true, max: 1 }).toUpperCase();
        if (!GENDERS.has(gender)) throw validationError("gender must be M, F, O, or U");
        result.gender = gender;
    }

    if (!partial || has("contactNumber")) result.contactNumber = cleanPhone(payload.contactNumber, "contactNumber", true);
    if (has("email")) result.email = cleanEmail(payload.email);
    if (has("preferredLanguage")) result.preferredLanguage = cleanString(payload.preferredLanguage, "preferredLanguage", { max: 50 });
    if (has("accessibilityNotes")) result.accessibilityNotes = cleanString(payload.accessibilityNotes, "accessibilityNotes", { max: 1000 });

    if (has("status")) {
        const status = cleanString(payload.status, "status", { required: true, max: 20 }).toUpperCase();
        if (!PARTICIPANT_STATUSES.has(status)) throw validationError("status is invalid");
        result.status = status;
    }

    if (partial && Object.keys(result).length === 0) throw validationError("No supported participant fields were supplied");
    return result;
}

function validateEmergencyContactPayload(payload, { partial = false } = {}) {
    const result = {};
    const has = (field) => Object.prototype.hasOwnProperty.call(payload, field);

    if (!partial || has("contactName")) result.contactName = cleanString(payload.contactName, "contactName", { required: true, max: 120 });
    if (!partial || has("relationship")) result.relationship = cleanString(payload.relationship, "relationship", { required: true, max: 60 });
    if (!partial || has("phoneNumber")) result.phoneNumber = cleanPhone(payload.phoneNumber, "phoneNumber", true);
    if (has("email")) result.email = cleanEmail(payload.email);
    if (has("isPrimary")) result.isPrimary = Boolean(payload.isPrimary);
    if (has("status")) {
        const status = cleanString(payload.status, "status", { required: true, max: 20 }).toUpperCase();
        if (!CONTACT_STATUSES.has(status)) throw validationError("status must be ACTIVE or REMOVED");
        result.status = status;
    }
    if (result.status === "REMOVED" && result.isPrimary === true) {
        throw validationError("A removed emergency contact cannot be the primary contact");
    }

    return result;
}

function validateConsentPayload(payload) {
    const consentFormVersionId = assertUuid(payload.consentFormVersionId, "consentFormVersionId");
    const consentStatus = cleanString(payload.consentStatus, "consentStatus", { required: true, max: 20 }).toUpperCase();
    const signerType = cleanString(payload.signerType, "signerType", { required: true, max: 40 }).toUpperCase();

    if (!CONSENT_STATUSES.has(consentStatus)) throw validationError("consentStatus must be ACCEPTED or DECLINED");
    if (!SIGNER_TYPES.has(signerType)) throw validationError("signerType is invalid");

    const result = {
        consentFormVersionId,
        consentStatus,
        signerType,
        signerName: cleanString(payload.signerName, "signerName", { required: true, max: 150 }),
        signerRelationship: cleanString(payload.signerRelationship, "signerRelationship", { required: signerType !== "PARTICIPANT", max: 60 }),
        guardianContactName: cleanString(payload.guardianContactName, "guardianContactName", { required: signerType !== "PARTICIPANT", max: 150 }),
        guardianContactPhone: cleanPhone(payload.guardianContactPhone, "guardianContactPhone", signerType !== "PARTICIPANT"),
        guardianContactEmail: cleanEmail(payload.guardianContactEmail, "guardianContactEmail"),
        signatureObjectKey: cleanString(payload.signatureObjectKey, "signatureObjectKey", { max: 500 }),
        signatureSha256: cleanString(payload.signatureSha256, "signatureSha256", { max: 64 }),
        signatureMimeType: cleanString(payload.signatureMimeType, "signatureMimeType", { max: 100 }),
    };

    if (consentStatus === "ACCEPTED") {
        if (!result.signatureObjectKey || !/^[a-f0-9]{64}$/i.test(result.signatureSha256 || "")) {
            throw validationError("Accepted consent requires a signature object key and SHA-256 hash");
        }
        if (!result.signatureMimeType) throw validationError("Accepted consent requires a signature MIME type");
    }

    return result;
}

function parsePositiveInt(value, fallback, maximum = 100) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1) throw validationError("Pagination values must be positive integers");
    return Math.min(parsed, maximum);
}

function validateIdempotencyKey(value) {
    const key = cleanString(value, "Idempotency-Key", { required: true, max: 100 });
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) {
        throw validationError("Idempotency-Key must contain 8-100 safe characters");
    }
    return key;
}

module.exports = {
    assertUuid,
    cleanString,
    parsePositiveInt,
    validateParticipantPayload,
    validateEmergencyContactPayload,
    validateConsentPayload,
    validateIdempotencyKey,
    validationError,
};
