-- Template keys are opaque unique identifiers. Screening import semantics
-- live in station_type; legacy non-screening catalog rows remain nullable.
ALTER TABLE "station_templates"
ADD COLUMN "station_type" "StationType";

UPDATE "station_templates"
SET "station_type" = "template_key"::"StationType"
WHERE "template_key" IN ('VISUAL_ACUITY', 'REFRACTION', 'COLOUR_VISION', 'EYE_HEALTH');

CREATE INDEX "station_templates_station_type_active_idx"
ON "station_templates"("station_type", "active");

ALTER TABLE "stations"
ADD COLUMN "station_template_id" UUID;

UPDATE "stations" AS station
SET "station_template_id" = template."station_template_id"
FROM "station_templates" AS template
WHERE template."template_key" = station."station_type"::text;

ALTER TABLE "stations"
ADD CONSTRAINT "stations_station_template_id_fkey"
FOREIGN KEY ("station_template_id") REFERENCES "station_templates"("station_template_id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "stations_station_template_id_idx"
ON "stations"("station_template_id");
