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
    assert.match(schema, /model UserCredential\s*\{/);
    assert.match(schema, /passwordHash\s+String/);
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
    const app = read("app.js");
    const participants = read("routes/participantRoutes.js");
    const events = read("routes/eventRoutes.js");
    const registrations = read("routes/registrationRoutes.js");
    const auth = read("routes/authRoutes.js");
    assert.match(app, /"\/api\/v1\/consent-forms"/);
    assert.match(app, /"\/api\/v1\/emergency-contacts"/);
    assert.match(participants, /"\/:participantId\/registrations"/);
    assert.match(participants, /"\/:participantId\/consents"/);
    assert.match(events, /"\/:eventId\/registrations"/);
    assert.match(events, /"\/active"/);
    assert.ok(events.indexOf('"/active"') < events.indexOf('"/:eventId"'), "active events route must precede the dynamic event route");
    assert.match(registrations, /"\/:registrationId\/history"/);
    for (const route of ["/authorize", "/callback", "/logout", "/refresh", "/me"]) {
        assert.ok(auth.includes(`"${route}"`), `missing auth route ${route}`);
    }
});

test("event and screening routes share one authentication and mutation-limit pass", () => {
    const app = read("app.js");
    const events = read("routes/eventRoutes.js");
    const screenings = read("routes/screeningRoutes.js");
    assert.equal((app.match(/authenticate, eventRoutes, screeningRoutes/g) || []).length, 2);
    assert.doesNotMatch(events, /router\.use\(authenticate\)/);
    assert.doesNotMatch(screenings, /router\.use\(authenticate\)/);
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
    const migration = read("prisma/migrations/20260727010000_integrate_secure_registration/migration.sql");
    assert.match(migration, /participant_reference.*participant_id/s);
    assert.match(migration, /idempotency_key.*legacy-/s);
    assert.doesNotMatch(migration, /DROP TABLE "user_credentials"/);
    assert.doesNotMatch(migration, /DROP TABLE "refresh_sessions"/);
    assert.match(migration, /participant_emergency_contacts_one_active_primary_key/);
    assert.match(migration, /WHERE "is_primary" = true AND "status" = 'ACTIVE'/);
    assert.match(migration, /participant_consents_one_accepted_per_event_key/);
    assert.match(migration, /withdrawal_of_id/);
});

test("event service exposes list functions after merge resolution", () => {
    const eventService = require("../services/eventService");
    assert.equal(typeof eventService.listEvents, "function");
    assert.equal(typeof eventService.listActiveEvents, "function");
    assert.equal(typeof eventService.listStationTemplates, "function");
});

test("listStationTemplates reads active StationTemplate rows", () => {
    const source = read("services/eventService.js");
    const listFn = source.slice(source.indexOf("const listStationTemplates"));
    assert.match(listFn, /stationTemplate\.findMany/);
    assert.match(listFn, /active:\s*true/);
    assert.match(listFn, /stationTemplateId:\s*true/);
    assert.match(listFn, /templateKey:\s*true/);
    assert.match(listFn, /defaultCapacity:\s*true/);
    assert.doesNotMatch(listFn.slice(0, listFn.indexOf("stationTemplatesUnavailable")), /return\s+\[\];/);
});

test("participant search matches any supplied identifier", () => {
    const service = read("services/participantService.js");
    assert.match(service, /return\s+\{\s*OR:\s*clauses\s*\}/);
});

test("managed authentication verifies both Cognito cookie and compatibility bearer tokens", () => {
    const controller = read("controllers/authController.js");
    const middleware = read("middlewares/requireAuthentication.js");
    const authRoutes = read("routes/authRoutes.js");
    assert.match(controller, /utils\/cognitoClient/);
    assert.match(middleware, /verifyAccessToken/);
    assert.match(middleware, /verifyCognitoToken/);
    assert.match(middleware, /ACCESS_COOKIE/);
    assert.match(authRoutes, /"\/authorize"/);
});

test("browser mutations recover the CSRF token after a page reload", () => {
    const client = read("../react-user-dashboard/src/utils/apiClient.ts");
    assert.match(client, /const requestCsrfToken = csrfToken \|\| getCsrfToken\(\)/);
    assert.match(client, /config\.headers\["X-CSRF-Token"\] = requestCsrfToken/);
});

test("browser session restoration rejects stale profile storage without a session cookie", () => {
    const provider = read("../react-user-dashboard/src/auth/AuthProvider.tsx");
    const session = read("../react-user-dashboard/src/utils/session.ts");
    const client = read("../react-user-dashboard/src/utils/apiClient.ts");
    assert.match(provider, /if \(!getCsrfToken\(\)\) \{[\s\S]*clearStoredSession\(\);[\s\S]*setSessionState\(null\);/);
    assert.match(session, /sessionStorage\.getItem\(SESSION_KEY\); \} catch \{ return null; \}/);
    assert.match(client, /volatileDeviceId \?\?= crypto\.randomUUID\(\)/);
    assert.match(read("../react-user-dashboard/src/main.tsx"), /try \{ savedTheme = localStorage\.getItem/);
    assert.match(read("../react-user-dashboard/src/components/MagicEffects.tsx"), /try \{ localStorage\.setItem\('vsms-theme'/);
});

test("theme toggles apply every click without a transient browser transition", () => {
    const toggle = read("../react-user-dashboard/src/components/MagicEffects.tsx");
    assert.match(toggle, /applyTheme\(next\);\s+setTheme\(next\);/);
    assert.doesNotMatch(toggle, /startViewTransition|isTransitioningRef/);
});

test("managed password changes use autofill semantics and suppress duplicate submits", () => {
    const page = read("../react-user-dashboard/src/pages/AccountSecurityPage.tsx");
    assert.match(page, /autoComplete="current-password"/);
    assert.match(page, /autoComplete="new-password"/);
    assert.match(page, /disabled=\{pending \|\| !oldPassword \|\| !isPasswordValid\(newPassword\)\}/);
});

test("event creation controls use the same verified role grants as the API", () => {
    const page = read("../react-user-dashboard/src/components/TestHomePage.tsx");
    assert.match(page, /role === 'ADMINISTRATOR' \|\| role === 'EVENT_MANAGER'/);
    assert.doesNotMatch(page, /systemRole !== 'STAFF'/);
});

test("event mutations invalidate stale export receipts", () => {
    const page = read("../react-user-dashboard/src/features/events/EventDetailPage.tsx");
    assert.match(page, /const applyEventUpdate = \(updated: EventRecord\) => \{ setEvent\(updated\); setExportReceipt\(''\); \}/);
    assert.match(page, /applyEventUpdate\(updated\)/);
});
