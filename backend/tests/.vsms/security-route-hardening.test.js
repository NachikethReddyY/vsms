const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const requireRecentAuthentication = require("../../middlewares/requireRecentAuthentication");
const {
  createRegistrationBody,
  registrationStatusBody,
} = require("../../schemas/registrationSchemas");
const {
  manualCheckInBody,
  qrPassParams,
  registrationParams,
} = require("../../schemas/qrSchemas");

test("registration and QR schemas reject unknown properties and invalid identifiers", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  assert.equal(createRegistrationBody.safeParse({ participantId: id, eventId: id }).success, true);
  assert.equal(createRegistrationBody.safeParse({ participantId: id, eventId: id, role: "ADMINISTRATOR" }).success, false);
  assert.equal(registrationStatusBody.safeParse({ toStatus: "COMPLETED", createdBy: id }).success, false);
  assert.equal(registrationParams.safeParse({ registrationId: "not-a-uuid" }).success, false);
  assert.equal(qrPassParams.safeParse({ qrId: id }).success, true);
});

test("manual check-in accepts exactly one event-scoped registration or QR reference", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const registrationId = "22222222-2222-4222-8222-222222222222";
  const token = "ab".repeat(32);

  assert.equal(manualCheckInBody.safeParse({ eventId, registrationId }).success, true);
  assert.equal(manualCheckInBody.safeParse({ eventId, identifier: token }).success, true);
  assert.equal(manualCheckInBody.safeParse({ eventId }).success, false);
  assert.equal(manualCheckInBody.safeParse({ eventId, registrationId, identifier: token }).success, false);
});

test("recent-authentication guard accepts a fresh session", async () => {
  const middleware = requireRecentAuthentication(60);
  let passed = false;
  await middleware({ auth: { authenticatedAt: Math.floor(Date.now() / 1000) } }, {}, (error) => {
    assert.equal(error, undefined);
    passed = true;
  });
  assert.equal(passed, true);
});

test("recent-authentication guard rejects stale sensitive operations", async () => {
  const middleware = requireRecentAuthentication(60);
  let received;
  await middleware({ auth: { authenticatedAt: Math.floor(Date.now() / 1000) - 61 } }, {}, (error) => {
    received = error;
  });
  assert.equal(received.status, 401);
  assert.equal(received.code, "RECENT_AUTHENTICATION_REQUIRED");
});

test("route security contract keeps duplicate queue mutations equally guarded", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../routes/queueRoutes.js"), "utf8");
  for (const operation of ["call", "start", "skip"]) {
    assert.match(
      source,
      new RegExp(`"/events/:eventId/entries/:queueId/${operation}"[\\s\\S]{0,180}requireAnyRole[\\s\\S]{0,180}checkIdempotency`),
    );
    assert.match(
      source,
      new RegExp(`"/entries/:queueId/${operation}"[\\s\\S]{0,180}requireAnyRole[\\s\\S]{0,180}checkIdempotency`),
    );
  }
});

test("development QR pages are mounted only in development and all QR identifiers are validated", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../routes/qrRoutes.js"), "utf8");
  assert.match(source, /if \(env\.NODE_ENV === "development"\)/);
  assert.match(source, /"\/manual-checkin"[\s\S]{0,180}manualCheckInBody/);
  assert.match(source, /"\/revoke\/:qrId"[\s\S]{0,180}qrPassParams[\s\S]{0,180}revokeBody/);
});
