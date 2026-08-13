const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const schema = fs.readFileSync(path.join(root, "backend/prisma/schema.prisma"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "backend/prisma/migrations/20260811230000_dynamic_station_templates/migration.sql"),
  "utf8",
);

const modelSource = (name) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} must remain in the Prisma schema`);
  return match[1];
};

test("station schema fields used by event creation remain deployed", () => {
  const station = modelSource("Station");
  const template = modelSource("StationTemplate");

  assert.match(station, /fieldSchemaSnapshot\s+Json\?/);
  assert.match(station, /schemaVersion\s+Int\?/);
  assert.match(template, /fieldSchema\s+Json\?/);

  assert.match(migration, /ADD COLUMN "field_schema" JSONB/);
  assert.match(migration, /ADD COLUMN "field_schema_snapshot" JSONB/);
  assert.match(migration, /ADD COLUMN "schema_version" INTEGER/);
});
