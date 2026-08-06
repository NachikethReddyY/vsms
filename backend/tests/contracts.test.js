const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const backendRoot = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(backendRoot, relativePath), "utf8");

test("manual check-in contract accepts exactly one reference and always returns a message", () => {
    const document = YAML.parse(read("docs/openapi.yaml"));
    const schemas = document.components.schemas;
    const request = schemas.ManualCheckInRequest;
    const referenced = request.oneOf.map(({ $ref }) => schemas[$ref.split("/").at(-1)]);
    const matches = (schema, value) => {
        if (!schema.required.every((key) => Object.hasOwn(value, key))) return false;
        if (schema.additionalProperties === false) {
            if (!Object.keys(value).every((key) => Object.hasOwn(schema.properties, key))) return false;
        }
        for (const [key, candidate] of Object.entries(value)) {
            const allowed = schema.properties[key]?.enum;
            if (allowed && !allowed.includes(candidate)) return false;
        }
        return true;
    };
    const matchCount = (value) => referenced.filter((schema) => matches(schema, value)).length;

    assert.equal(matchCount({ eventId: "11111111-1111-4111-8111-111111111111" }), 0);
    assert.equal(matchCount({
        eventId: "11111111-1111-4111-8111-111111111111",
        registrationId: "22222222-2222-4222-8222-222222222222",
        identifier: "a".repeat(64),
    }), 0);
    assert.equal(matchCount({
        eventId: "11111111-1111-4111-8111-111111111111",
        registrationId: "22222222-2222-4222-8222-222222222222",
    }), 1);
    assert.equal(matchCount({
        eventId: "11111111-1111-4111-8111-111111111111",
        identifier: "a".repeat(64),
    }), 1);
    assert.ok(schemas.ManualCheckInResponse.required.includes("message"));
});

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
    assert.doesNotMatch(auth, /"\/login"|"\/signup"/);
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

test("event audit log rows are retained after hard delete and remain immutable", () => {
    const retentionMigration = read("prisma/migrations/20260803090000_preserve_event_audit_history/migration.sql");
    const triggerMigration = read("prisma/migrations/20260805023000_immutable_event_audit_log/migration.sql");
    const migration = read("prisma/migrations/20260806010000_preserve_immutable_event_audit_history/migration.sql");
    assert.match(retentionMigration, /DROP CONSTRAINT IF EXISTS "event_audit_logs_event_id_fkey"/);
    assert.match(triggerMigration, /BEFORE UPDATE OR DELETE ON "event_audit_logs"/);
    assert.doesNotMatch(migration, /event_audit_delete_event_id/);
    assert.match(migration, /ERRCODE = '42501'/);
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
    const end = listFn.indexOf("\nconst importStations");
    const body = end === -1 ? listFn : listFn.slice(0, end);
    assert.match(body, /stationTemplate\.findMany/);
    assert.match(body, /active:\s*true/);
    assert.match(body, /stationTemplateId:\s*true/);
    assert.match(body, /templateKey:\s*true/);
    assert.match(body, /defaultCapacity:\s*true/);
    assert.doesNotMatch(body, /return\s+\[\];/);
});

test("importStations and updateStation use Prisma Station not EventStation", () => {
    const source = read("services/eventService.js");
    assert.match(source, /const importStations = async/);
    assert.match(source, /const updateStation = async/);
    assert.doesNotMatch(source, /STATION_TEMPLATES_NOT_AVAILABLE/);
    assert.doesNotMatch(source, /tx\.eventStation\./);
    const importFn = source.slice(source.indexOf("const importStations = async"));
    const importBody = importFn.slice(0, importFn.indexOf("\nconst updateStation"));
    assert.match(importBody, /tx\.station\.(create|update|upsert)/);
    assert.match(importBody, /STATION_TEMPLATE_NOT_IMPORTABLE/);
    assert.match(importBody, /classifyTemplates|stationTypeForTemplateKey/);
    const updateFn = source.slice(source.indexOf("const updateStation = async"));
    const updateBody = updateFn.slice(0, updateFn.indexOf("\nconst addStaffAssignment"));
    assert.match(updateBody, /tx\.station\.update/);
    assert.match(updateBody, /isActive:\s*body\.isAvailable/);
});

test("station template mapping only imports screening StationTypes", () => {
    const mapping = require("../services/stationTemplateMapping");
    assert.equal(mapping.stationTypeForTemplateKey("VISUAL_ACUITY"), "VISUAL_ACUITY");
    assert.equal(mapping.stationTypeForTemplateKey("REFRACTION"), "REFRACTION");
    assert.equal(mapping.stationTypeForTemplateKey("COLOUR_VISION"), "COLOUR_VISION");
    assert.equal(mapping.stationTypeForTemplateKey("EYE_HEALTH"), null);
    assert.equal(mapping.stationTypeForTemplateKey("REGISTRATION"), null);
    assert.equal(mapping.stationTypeForTemplateKey("CLINICAL_REVIEW"), null);

    const { importable, skipped } = mapping.classifyTemplates([
        { templateKey: "REGISTRATION", name: "Registration" },
        { templateKey: "VISUAL_ACUITY", name: "Visual acuity" },
        { templateKey: "CLINICAL_REVIEW", name: "Clinical review" },
        { templateKey: "EYE_HEALTH", name: "Eye health" },
    ]);
    assert.deepEqual(importable.map(({ stationType }) => stationType), ["VISUAL_ACUITY"]);
    assert.deepEqual(skipped.map((template) => template.templateKey), ["REGISTRATION", "CLINICAL_REVIEW", "EYE_HEALTH"]);
});

test("participant search matches any supplied identifier", () => {
    const service = read("services/participantService.js");
    const controller = read("controllers/participantController.js");
    assert.match(service, /return\s+\{\s*OR:\s*clauses\s*\}/);
    assert.match(controller, /searchParticipantsService/);
});

test("authentication uses verified Cognito tokens and approved local role intersection", () => {
    const controller = read("controllers/authController.js");
    const middleware = read("middlewares/requireAuthentication.js");
    const authRoutes = read("routes/authRoutes.js");
    assert.match(controller, /verifyCognitoToken/);
    assert.match(middleware, /verifyCognitoToken/);
    assert.match(middleware, /rolesFromCognitoGroups/);
    assert.match(middleware, /filter\(\(role\) => rolesFromCognitoGroups\(payload\)\.includes\(role\)\)/);
    assert.match(authRoutes, /"\/authorize"/);
    assert.doesNotMatch(authRoutes, /"\/login"|"\/signup"/);
});

test("registration resolve accepts passToken, qrToken, or registrationId", () => {
    const { resolveQuery } = require("../schemas/screeningSchemas");
    assert.doesNotThrow(() => resolveQuery.parse({ passToken: "VSMS-DEMO-QR-001" }));
    assert.doesNotThrow(() => resolveQuery.parse({
        qrToken: "a".repeat(64),
    }));
    assert.doesNotThrow(() => resolveQuery.parse({
        registrationId: "11111111-1111-4111-8111-111111111111",
    }));
    assert.throws(() => resolveQuery.parse({}), /passToken, qrToken, or registrationId/);
});

test("resolveParticipant looks up QRCodePass when passToken is not on registration", () => {
    const source = read("services/screeningService.js");
    const fn = source.slice(source.indexOf("const resolveParticipant"));
    const body = fn.slice(0, fn.indexOf("\nconst previewStationResult"));
    assert.match(body, /resolveRegistrationByQrValue/);
    assert.match(body, /passToken/);
    assert.match(body, /qrToken/);

    const tokenHelper = read("utils/qrToken.js");
    assert.match(tokenHelper, /qRCodePass\.findFirst/);
    assert.match(tokenHelper, /tokenHash/);
});

test("QR station handoff contract is documented", () => {
    const doc = read("docs/qr-station-handoff.md");
    assert.match(doc, /token-only|token only/i);
    assert.match(doc, /registrationId/);
    assert.match(doc, /Do \*\*not\*\* put `stationId`|must \*\*not\*\* embed `stationId`/i);
    assert.match(doc, /\/events\/\{eventId\}\/stations\/\{slug\}\?registrationId=/);
    assert.match(doc, /visual-acuity/);
});

test("seed creates VA / refraction / colour vision Station rows", () => {
    const seed = read("prisma/seed.js");
    assert.match(seed, /\["VISUAL_ACUITY"/);
    assert.match(seed, /\["REFRACTION"/);
    assert.match(seed, /\["COLOUR_VISION"/);
    assert.match(seed, /Live event stations/);
});
