-- AlterEnum
ALTER TYPE "StationType" ADD VALUE 'CUSTOM';

ALTER TABLE "station_templates" ADD COLUMN "field_schema" JSONB;

ALTER TABLE "stations" ADD COLUMN "field_schema_snapshot" JSONB;
ALTER TABLE "stations" ADD COLUMN "schema_version" INTEGER;

ALTER TABLE "screening_results" ADD COLUMN "schema_version" INTEGER;

DROP INDEX IF EXISTS "stations_event_id_station_type_key";

CREATE INDEX "stations_event_id_station_type_is_active_idx"
  ON "stations"("event_id", "station_type", "is_active");

CREATE INDEX "stations_event_id_station_template_id_idx"
  ON "stations"("event_id", "station_template_id");
