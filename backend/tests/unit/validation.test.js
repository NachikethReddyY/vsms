const test = require("node:test");
const assert = require("node:assert/strict");
const {
    validateParticipantPayload,
    validateEmergencyContactPayload,
    validateConsentPayload,
    validateIdempotencyKey,
} = require("../../utils/validation/validation");

test("valid participant payload is normalized", () => {
    const value = validateParticipantPayload({
        firstName: "  John ",
        lastName: " Tan ",
        dateOfBirth: "1980-03-14",
        gender: "m",
        contactNumber: "+65 9123 4567",
        nric: "s123-4567d",
        email: "JOHN@example.com",
        race: "  Chinese ",
        nationality: " Singaporean ",
        addressStreet: "  10 Example Road ",
        addressUnit: " #03-12 ",
        addressPostalCode: " 123456 ",
        preferredLanguage: "English",
        accessibilityNotes: "",
        status: "active",
    });
    assert.equal(value.firstName, "John");
    assert.equal(value.gender, "M");
    assert.equal(value.email, "john@example.com");
    assert.equal(value.nric, "S1234567D");
    assert.equal(value.nricMasked, "•••••567D");
    assert.equal(value.race, "Chinese");
    assert.equal(value.nationality, "Singaporean");
    assert.equal(value.addressStreet, "10 Example Road");
    assert.equal(value.addressUnit, "#03-12");
    assert.equal(value.addressPostalCode, "123456");
    assert.equal(value.accessibilityNotes, null);
    assert.equal(value.status, "ACTIVE");
});

test("participant rejects future DOB, invalid email, phone, enum and missing names", () => {
    const base = {
        firstName: "John",
        lastName: "Tan",
        dateOfBirth: "1980-03-14",
        gender: "M",
        contactNumber: "+6591234567",
        nric: "S1234567D",
    };
    assert.throws(() => validateParticipantPayload({ ...base, dateOfBirth: "2999-01-01" }), /future/);
    assert.throws(() => validateParticipantPayload({ ...base, email: "not-an-email" }), /email is invalid/);
    assert.throws(() => validateParticipantPayload({ ...base, contactNumber: "abc" }), /contactNumber is invalid/);
    assert.throws(() => validateParticipantPayload({ ...base, nric: "" }), /nric is required/);
    assert.throws(() => validateParticipantPayload({ ...base, nric: "not-an-nric" }), /nric must be a valid NRIC or FIN/);
    assert.throws(() => validateParticipantPayload({ ...base, gender: "X" }), /gender/);
    assert.throws(() => validateParticipantPayload({ ...base, firstName: " " }), /firstName is required/);
});

test("emergency contact validates active/removal history fields", () => {
    const value = validateEmergencyContactPayload({
        contactName: "Mary Tan",
        relationship: "Spouse",
        phoneNumber: "+6598765432",
        email: "mary@example.com",
        isPrimary: true,
        status: "ACTIVE",
    });
    assert.equal(value.isPrimary, true);
    assert.equal(value.status, "ACTIVE");
    assert.throws(() => validateEmergencyContactPayload({ ...value, status: "DELETED" }), /ACTIVE or REMOVED/);
    assert.throws(
        () => validateEmergencyContactPayload({ ...value, status: "REMOVED", isPrimary: true }),
        /removed emergency contact cannot be the primary contact/i
    );
});

test("accepted consent requires signer and signature evidence", () => {
    const base = {
        consentFormVersionId: "44444444-4444-4444-8444-444444444444",
        consentStatus: "ACCEPTED",
        signerType: "PARTICIPANT",
        signerName: "John Tan",
        signatureObjectKey: "signatures/example.png",
        signatureSha256: "a".repeat(64),
        signatureMimeType: "image/png",
    };
    assert.equal(validateConsentPayload(base).consentStatus, "ACCEPTED");
    assert.throws(() => validateConsentPayload({ ...base, signatureSha256: "" }), /signature/);
    assert.throws(() => validateConsentPayload({ ...base, consentStatus: "WITHDRAWN" }), /ACCEPTED or DECLINED/);
});

test("representative consent requires relationship and contact information", () => {
    const base = {
        consentFormVersionId: "44444444-4444-4444-8444-444444444444",
        consentStatus: "DECLINED",
        signerType: "GUARDIAN",
        signerName: "Guardian",
    };
    assert.throws(() => validateConsentPayload(base), /signerRelationship/);
});

test("idempotency keys have bounded safe syntax", () => {
    assert.equal(validateIdempotencyKey("registration:1234"), "registration:1234");
    assert.throws(() => validateIdempotencyKey("short"), /8-100/);
    assert.throws(() => validateIdempotencyKey("unsafe key!"), /safe characters/);
});
