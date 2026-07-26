const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(backendRoot, relativePath), "utf8");

test("schema enforces duplicate registration and queue uniqueness", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /@@unique\(\[participantId, eventId\]\)/);
    assert.match(schema, /@@unique\(\[eventId, queueNumber\]\)/);
    assert.match(schema, /@@unique\(\[registeredBy, idempotencyKey\]\)/);
    assert.doesNotMatch(schema, /passwordHash|model UserCredential/);
});

test("schema contains all required registration module tables", () => {
    const schema = read("prisma/schema.prisma");
    for (const model of [
        "User", "Role", "Permission", "UserRole", "RolePermission", "AuthAuditLog",
        "Participant", "ParticipantEmergencyContact", "ConsentFormVersion",
        "ParticipantConsent", "Event", "EventRegistration", "RegistrationStatusHistory",
        "AuditLog", "Device",
    ]) {
        assert.match(schema, new RegExp(`model ${model}\\s*\\{`), `missing ${model}`);
    }
});

test("API routes expose the required versioned contracts", () => {
    const server = read("server.js");
    const participants = read("routes/participantRoutes.js");
    const events = read("routes/eventRoutes.js");
    const registrations = read("routes/registrationRoutes.js");
    const auth = read("routes/authRoutes.js");
    assert.match(server, /"\/api\/v1\/consent-forms"/);
    assert.match(server, /"\/api\/v1\/emergency-contacts"/);
    assert.match(participants, /"\/:participantId\/registrations"/);
    assert.match(participants, /"\/:participantId\/consents"/);
    assert.match(events, /"\/:eventId\/registrations"/);
    assert.match(registrations, /"\/:registrationId\/history"/);
    for (const route of ["/login", "/logout", "/refresh", "/me", "/change-password", "/forgot-password", "/confirm-forgot-password"]) {
        assert.ok(auth.includes(`"${route}"`), `missing auth route ${route}`);
    }
});

test("registration transaction creates registration, history and audit together", () => {
    const controller = read("controllers/registrationController.js");
    const transactionBody = controller.slice(controller.indexOf("prisma.$transaction"));
    assert.match(transactionBody, /eventRegistration\.create/);
    assert.match(transactionBody, /registrationStatusHistory\.create/);
    assert.match(transactionBody, /createAuditLog/);
    assert.match(transactionBody, /isolationLevel:\s*"Serializable"/);
    assert.match(controller, /DUPLICATE_REGISTRATION_BLOCKED/);
});

test("migration preserves history and enforces one active primary contact", () => {
    const migration = read("prisma/migrations/20260726170000_complete_secure_registration/migration.sql");
    assert.match(migration, /ROW_NUMBER\(\) OVER/);
    assert.match(migration, /LPAD\(numbered_participants\.legacy_number::TEXT, 12, '0'\)/);
    assert.doesNotMatch(migration, /LEFT\(REPLACE\("participant_id"/);
    assert.match(migration, /one_active_primary_emergency_contact_per_participant/);
    assert.match(migration, /WHERE "is_primary" = TRUE AND "status" = 'ACTIVE'/);
    assert.match(migration, /one_active_consent_form/);
    assert.match(migration, /withdrawal_of_id/);
});

test("Cognito configuration requires administrator-created staff and complete MFA enrollment", () => {
    const template = read("../infrastructure/cognito.yaml");
    const client = read("utils/cognitoClient.js");
    const authRoutes = read("routes/authRoutes.js");
    assert.match(template, /AllowAdminCreateUserOnly:\s+true/);
    assert.match(template, /MfaConfiguration:\s+"ON"/);
    assert.match(template, /SOFTWARE_TOKEN_MFA/);
    assert.match(client, /NEW_PASSWORD_REQUIRED/);
    assert.match(client, /AssociateSoftwareToken/);
    assert.match(client, /VerifySoftwareToken/);
    assert.match(client, /ChallengeName:\s*"MFA_SETUP"/);
    assert.doesNotMatch(authRoutes, /signup|confirm-signup|resend-code/);
});
