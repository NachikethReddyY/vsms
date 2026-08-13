const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("registration routines remove consent signatures and restrict database execution", () => {
  const schema = read("backend/prisma/schema.prisma");
  const consentMigration = read("backend/prisma/migrations/20260813113000_remove_participant_consent_workflow/migration.sql");
  const routines = read("backend/prisma/migrations/20260813150100_add_registration_stored_functions/migration.sql");
  const consentRemoval = read("backend/prisma/migrations/20260813170000_remove_registration_consent_acknowledgement/migration.sql");
  const runtimeRole = read("backend/prisma/runtime-role.example.sql");

  assert.doesNotMatch(schema, /model ParticipantConsent \{|model ConsentFormVersion \{|\bCONSENT\b/);
  assert.match(consentMigration, /DROP TABLE IF EXISTS "participant_consents"/);
  assert.match(consentMigration, /DELETE FROM "signature_artifacts" WHERE "purpose" = 'CONSENT'/);
  assert.doesNotMatch(schema, /consentAcknowledged/);
  assert.match(consentRemoval, /DROP COLUMN IF EXISTS consent_acknowledged/);
  assert.doesNotMatch(consentRemoval, /p_consent_acknowledged/);
  assert.match(consentRemoval, /FROM public\.event_registrations AS registration/);
  assert.match(consentRemoval, /CREATE OR REPLACE FUNCTION public\.check_in_event_registration/);
  assert.equal((routines.match(/SET search_path = pg_catalog, public/g) || []).length, 4);
  assert.equal((routines.match(/REVOKE ALL ON FUNCTION/g) || []).length, 4);
  assert.equal((runtimeRole.match(/GRANT EXECUTE ON FUNCTION/g) || []).length, 4);
});
