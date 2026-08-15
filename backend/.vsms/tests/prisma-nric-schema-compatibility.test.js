const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(backendRoot, relativePath), "utf8");

test("participant encryption fields remain aligned across Prisma and migrations", () => {
  const schema = read("prisma/schema.prisma");
  const participant = schema.match(/model Participant \{[\s\S]*?\n\}/)?.[0] || "";
  const migration = read(
    "prisma/migrations/20260815120000_restore_participant_nric_encryption/migration.sql",
  );

  for (const [prismaField, databaseColumn] of [
    ["nricCiphertext", "nric_ciphertext"],
    ["nricLookupHash", "nric_lookup_hash"],
    ["nricEncryptionVersion", "nric_encryption_version"],
  ]) {
    assert.match(participant, new RegExp(`\\b${prismaField}\\b`));
    assert.match(migration, new RegExp(`ADD COLUMN "${databaseColumn}"`));
  }

  assert.match(participant, /nricLookupHash\s+String\?\s+@unique/);
  assert.match(migration, /participants_encrypted_nric_shape_check/);
  assert.match(migration, /participants_nric_lookup_hash_key/);
});

test("every package seed entry point regenerates Prisma Client first", () => {
  const { scripts } = JSON.parse(read("package.json"));

  assert.equal(
    scripts["prisma:seed"],
    "pnpm prisma:generate && node prisma/seed.js",
  );
  assert.equal(scripts.seed, "pnpm prisma:seed");
  assert.equal(scripts["db:setup"], "pnpm prisma:migrate && pnpm prisma:seed");
});
