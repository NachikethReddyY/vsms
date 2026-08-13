const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("legacy registration fields are removed without losing emergency contacts", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read("backend/prisma/migrations/20260813180000_remove_legacy_registration_columns/migration.sql");
  const service = read("backend/services/participant/participantService.js");
  const openapi = read("backend/docs/openapi.yaml");
  const participant = schema.match(/model Participant \{[\s\S]*?\n\}/)?.[0] || "";
  const registration = schema.match(/model EventRegistration \{[\s\S]*?\n\}/)?.[0] || "";

  assert.doesNotMatch(participant, /\bemergencyContact(Name)?\b/);
  assert.doesNotMatch(registration, /\bpassToken\b/);
  assert.match(migration, /INSERT INTO public\.participant_emergency_contacts/);
  assert.ok(migration.indexOf("INSERT INTO") < migration.indexOf("DROP COLUMN"));
  assert.match(migration, /NOT EXISTS[\s\S]*contact\.status = 'ACTIVE'/);
  assert.doesNotMatch(service, /emergencyContact: data\.contactNumber/);
  assert.doesNotMatch(openapi, /required: \[[^\]]*passToken/);
});
