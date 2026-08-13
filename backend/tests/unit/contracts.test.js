const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const backendRoot = path.resolve(__dirname, "../..");
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
        "Participant", "ParticipantEmergencyContact", "Event", "EventRegistration", "RegistrationStatusHistory",
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
    assert.doesNotMatch(app, /"\/api\/v1\/consent-forms"/);
    assert.match(app, /"\/api\/v1\/emergency-contacts"/);
    assert.match(participants, /"\/:participantId\/registrations"/);
    assert.doesNotMatch(participants, /"\/:participantId\/consents"/);
    assert.match(events, /"\/:eventId\/registrations"/);
    assert.match(events, /"\/active"/);
    assert.ok(events.indexOf('"/active"') < events.indexOf('"/:eventId"'), "active events route must precede the dynamic event route");
    assert.match(registrations, /"\/:registrationId\/history"/);
    assert.doesNotMatch(read("controllers/registrationController.js"), /consentAcknowledged/);
    for (const route of ["/authorize", "/callback", "/logout", "/refresh", "/me"]) {
        assert.ok(auth.includes(`"${route}"`), `missing auth route ${route}`);
    }
    assert.doesNotMatch(auth, /"\/login"|"\/signup"/);
});

test("school API map records the actual Cognito, PATCH, and event-scoped contract", () => {
    const document = YAML.parse(read("docs/openapi.yaml"));
    const map = fs.readFileSync(path.resolve(backendRoot, "../docs/03-Architecture/api-contract-mapping.md"), "utf8");
    assert.ok(document.paths["/api/v1/auth/authorize"].get);
    assert.ok(document.paths["/api/v1/events/{eventId}"].patch);
    assert.ok(document.paths["/api/v1/participants/{participantId}"].patch);
    assert.ok(document.paths["/api/v1/events/{eventId}/stations/{stationId}/visual-acuity"].post);
    assert.ok(document.paths["/api/v1/events/{eventId}/stations/{stationId}/eye-health"].post);
    assert.ok(document.paths["/api/v1/events/{eventId}/sync/screening"].post);
    assert.match(map, /Cognito authorization-code \+ PKCE/);
    assert.match(map, /`PATCH \/api\/v1\/events\/\{eventId\}`/);
    assert.match(map, /`POST \/api\/v1\/events\/\{eventId\}\/sync\/screening`/);
    assert.match(map, /`POST \/api\/v1\/events\/\{eventId\}\/stations\/\{stationId\}\/eye-health`/);
});

test("recorded reviews expose optional eye-health observations as nullable", () => {
    const document = YAML.parse(read("docs/openapi.yaml"));
    assert.equal(document.components.schemas.RecordedReview.properties.eyeHealthObservations.nullable, true);
});

test("route override contract is versioned, reason-allowlisted, and role-neutral", () => {
    const document = YAML.parse(read("docs/openapi.yaml"));
    const operation = document.paths["/api/v1/queues/events/{eventId}/participants/{registrationId}/route"].patch;
    const request = document.components.schemas.RouteOverrideRequest;
    assert.ok(operation.responses["409"]);
    assert.deepEqual(request.required, ["stationIds", "reasonCode", "expectedVersion"]);
    assert.equal(request.properties.stationIds.uniqueItems, true);
    assert.equal(Object.hasOwn(request.properties, "role"), false);
    assert.ok(document.components.schemas.RouteOverrideReasonCode.enum.includes("STATION_UNAVAILABLE"));
});

test("account contracts allow composed runtime fields and document provider maintenance", () => {
    const document = YAML.parse(read("docs/openapi.yaml"));
    const schemas = document.components.schemas;
    const adminRoutes = read("routes/adminRoutes.js");

    assert.equal(schemas.AccountSummary.additionalProperties, true);
    assert.ok(schemas.Account.allOf.some(({ $ref }) => $ref === "#/components/schemas/AccountSummary"));
    assert.ok(schemas.AccountDetail.allOf.some(({ $ref }) => $ref === "#/components/schemas/Account"));
    assert.ok(schemas.AccountListItem.allOf.some(({ $ref }) => $ref === "#/components/schemas/AccountSummary"));
    assert.ok(schemas.AccountProviderOperationStatus.enum.includes("RESOLVED"));
    assert.ok(document.paths["/api/v1/admin/maintenance/account-provider-operations/{operationId}/requeue"]);
    assert.ok(document.paths["/api/v1/admin/maintenance/account-provider-operations/{operationId}/resolve"]);
    assert.match(adminRoutes, /account-provider-operations\/:operationId\/requeue/);
    assert.match(adminRoutes, /account-provider-operations\/:operationId\/resolve/);
    assert.ok(document.paths["/api/v1/admin/accounts/{accountId}/reactivate"].post.responses["202"]);
    assert.ok(document.paths["/api/v1/users"].post.responses["202"]);
});

test("registration service delegates atomic registration work to stored functions", () => {
    const controller = read("controllers/registrationController.js");
    const service = read("services/participant/registrationService.js");
    const qrService = read("services/participant/qrService.js");
    const migration = read("prisma/migrations/20260813150100_add_registration_stored_functions/migration.sql");
    const consentRemoval = read("prisma/migrations/20260813170000_remove_registration_consent_acknowledgement/migration.sql");
    const transactionBody = service.slice(service.indexOf("db.$transaction"));
    assert.match(transactionBody, /register_participant_for_event/);
    assert.match(service, /cancel_event_registration/);
    assert.match(qrService, /check_in_event_registration/);
    assert.match(service, /get_event_registration_summary/);
    assert.match(transactionBody, /createAuditLog/);
    assert.match(transactionBody, /isolationLevel:\s*"ReadCommitted"/);
    assert.match(service, /DUPLICATE_REGISTRATION_BLOCKED/);
    assert.match(controller, /registrationService\.createRegistration/);
    assert.match(controller, /registrationService\.getEventRegistrationSummary/);
    assert.doesNotMatch(controller, /prisma/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION "register_participant_for_event"/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION "cancel_event_registration"/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION "check_in_event_registration"/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION "get_event_registration_summary"/);
    assert.match(migration, /registration_status_history/);
    assert.match(consentRemoval, /DROP COLUMN IF EXISTS consent_acknowledged/);
    assert.doesNotMatch(consentRemoval, /p_consent_acknowledged/);
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
    const eventService = require("../../services/event/eventService");
    assert.equal(typeof eventService.listEvents, "function");
    assert.equal(typeof eventService.listActiveEvents, "function");
    assert.equal(typeof eventService.listStationTemplates, "function");
});

test("listStationTemplates reads active StationTemplate rows", () => {
    const source = read("services/event/eventService.js");
    const listFn = source.slice(source.indexOf("const listStationTemplates"));
    const end = listFn.indexOf("\nconst importStations");
    const body = end === -1 ? listFn : listFn.slice(0, end);
    assert.match(body, /stationTemplate\.findMany/);
    assert.match(body, /active:\s*true/);
    assert.match(body, /stationTemplateId:\s*true/);
    assert.match(body, /stationType:\s*true/);
    assert.match(body, /defaultCapacity:\s*true/);
    assert.doesNotMatch(body, /return\s+\[\];/);
});

test("importStations and updateStation use Prisma Station not EventStation", () => {
    const source = read("services/event/eventService.js");
    assert.match(source, /const importStations = async/);
    assert.match(source, /const updateStation = async/);
    assert.doesNotMatch(source, /STATION_TEMPLATES_NOT_AVAILABLE/);
    assert.doesNotMatch(source, /tx\.eventStation\./);
    const importFn = source.slice(source.indexOf("const importStations = async"));
    const importBody = importFn.slice(0, importFn.indexOf("\nconst updateStation"));
    assert.match(importBody, /tx\.station\.(create|update|upsert)/);
    assert.match(importBody, /STATION_TEMPLATE_NOT_IMPORTABLE/);
    assert.match(importBody, /classifyTemplates|stationTypeForTemplate/);
    const updateFn = source.slice(source.indexOf("const updateStation = async"));
    const updateBody = updateFn.slice(0, updateFn.indexOf("\nconst addStaffAssignment"));
    assert.match(updateBody, /tx\.station\.update/);
    assert.match(updateBody, /isActive:\s*body\.isAvailable/);
});

test("station template mapping imports the explicit screening stationType", () => {
    const mapping = require("../../services/event/stationTemplateMapping");
    assert.equal(mapping.stationTypeForTemplate({ templateKey: "opaque", stationType: "VISUAL_ACUITY" }), "VISUAL_ACUITY");
    assert.equal(mapping.stationTypeForTemplate({ templateKey: "VISUAL_ACUITY", stationType: null }), null);

    const { importable, skipped } = mapping.classifyTemplates([
        { templateKey: "REGISTRATION", stationType: null, name: "Registration" },
        { templateKey: "opaque-1", stationType: "VISUAL_ACUITY", name: "Visual acuity" },
        { templateKey: "CLINICAL_REVIEW", stationType: null, name: "Clinical review" },
        { templateKey: "opaque-2", stationType: "EYE_HEALTH", name: "Eye health" },
    ]);
    assert.deepEqual(importable.map(({ stationType }) => stationType), ["VISUAL_ACUITY"]);
    assert.deepEqual(skipped.map((template) => template.templateKey), ["REGISTRATION", "CLINICAL_REVIEW", "opaque-2"]);
});

test("participant search matches any supplied identifier", () => {
    const service = read("services/participant/participantService.js");
    const controller = read("controllers/participantController.js");
    assert.match(service, /return\s+\{\s*OR:\s*clauses\s*\}/);
    assert.match(controller, /searchParticipantsService/);
});

test("registration match requires at least two participant identifiers", () => {
    const service = read("services/participant/participantService.js");
    const routes = read("routes/participantRoutes.js");
    const document = YAML.parse(read("docs/openapi.yaml"));
    const response = document.components.schemas.ParticipantMatchResponse;
    assert.match(service, /matchParticipantsForRegistrationService/);
    assert.match(service, /A name alone is not enough to classify a participant as a possible duplicate/);
    assert.match(routes, /router\.post\("\/match"/);
    assert.deepEqual(response.properties.result.enum, ["NO_MATCH", "POSSIBLE_MATCH", "ALREADY_REGISTERED"]);
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

test("registration resolve accepts secure QR values or registrationId and rejects legacy/demo values", () => {
    const { resolveQuery } = require("../../schemas/screeningSchemas");
    assert.doesNotThrow(() => resolveQuery.parse({ passToken: "a".repeat(64) }));
    assert.doesNotThrow(() => resolveQuery.parse({
        qrToken: `https://app.example.com/participant-status/${"b".repeat(64)}`,
    }));
    assert.doesNotThrow(() => resolveQuery.parse({
        registrationId: "11111111-1111-4111-8111-111111111111",
    }));
    assert.throws(() => resolveQuery.parse({ passToken: "VSMS-DEMO-QR-001" }), /valid secure QR pass/);
    assert.throws(() => resolveQuery.parse({ qrToken: "malformed" }), /valid secure QR pass|too small/i);
    assert.throws(() => resolveQuery.parse({}), /passToken, qrToken, or registrationId/);
});

test("general QR verification normalizes only secure raw tokens and participant URLs", () => {
    const { tokenBody } = require("../../schemas/qrSchemas");
    assert.equal(tokenBody.parse({ token: "a".repeat(64) }).token, "a".repeat(64));
    assert.equal(tokenBody.parse({
        token: `https://app.example.com/participant-status/${"b".repeat(64)}`,
    }).token, "b".repeat(64));
    assert.throws(() => tokenBody.parse({ token: "VSMS-DEMO-QR-001" }), /too small|secure QR/i);
    assert.throws(() => tokenBody.parse({ token: "a".repeat(64), unexpected: true }), /unrecognized key/i);
});

test("resolveParticipant looks up QRCodePass when passToken is not on registration", () => {
    const source = read("services/screening/screeningService.js");
    const fn = source.slice(source.indexOf("const resolveParticipant"));
    const body = fn.slice(0, fn.indexOf("\nconst previewStationResult"));
    assert.match(body, /resolveRegistrationByQrValue/);
    assert.match(body, /passToken/);
    assert.match(body, /qrToken/);

    const tokenHelper = read("utils/crypto/qrToken.js");
    assert.match(tokenHelper, /qRCodePass\.findFirst/);
    assert.match(tokenHelper, /tokenHash/);
    assert.doesNotMatch(tokenHelper, /eventRegistration\.findFirst/);
    assert.doesNotMatch(tokenHelper, /where: \{ eventId, passToken/);
});

test("demo QR fixtures are forbidden in production", () => {
    assert.match(read("prisma/seed.js"), /NODE_ENV === "production"[\s\S]*Demo seed execution is forbidden/);
    assert.match(read("scripts/dev-preset.js"), /env\.isProduction[\s\S]*Development preset execution is forbidden/);
    const packageJson = JSON.parse(read("package.json"));
    assert.equal(packageJson.scripts["deploy:prod"], undefined);
    assert.match(packageJson.scripts["setup:demo"], /assert-non-production/);
});

test("single participant QR has no public generated-handoff path", () => {
    assert.doesNotMatch(read("routes/qrRoutes.js"), /\/handoff\/:token/);
    assert.doesNotMatch(read("services/participant/qrService.js"), /getStationHandoffQR|buildStationHandoffUrl/);
    assert.doesNotMatch(read("controllers/qrController.js"), /getStationHandoffQR/);
});

test("manual queue movement endpoints are retired while station status remains documented", () => {
    const openapi = read("docs/openapi.yaml");
    assert.match(openapi, /\/api\/v1\/queues\/events\/\{eventId\}\/stations:/);
    assert.doesNotMatch(openapi, /\/api\/v1\/queues\/events\/\{eventId\}\/stations\/\{stationId\}\/(?:handoff|join):/);
    assert.doesNotMatch(openapi, /\/api\/v1\/queues\/(?:events\/\{eventId\}\/)?entries\/\{queueId\}\/(?:advance|complete):/);
    assert.match(openapi, /operationalStatus: \{ \$ref: "#\/components\/schemas\/StationOperationalStatus" \}/);
});

test("seed creates VA / refraction / colour vision Station rows", () => {
    const seed = read("prisma/seed.js");
    assert.match(seed, /\["VISUAL_ACUITY"/);
    assert.match(seed, /\["REFRACTION"/);
    assert.match(seed, /\["COLOUR_VISION"/);
    assert.match(seed, /Live event stations/);
});

test("seeded screener identity is synthetic by default", () => {
    const seed = read("prisma/seed.js");
    assert.match(seed, /synthetic\.screener@example\.test/);
    assert.doesNotMatch(seed, /@gmail\.com/);
});
