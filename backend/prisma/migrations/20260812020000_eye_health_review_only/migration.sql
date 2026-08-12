-- Eye health is clinician-review only: deactivate legacy screener stations and
-- convert catalog entries so they are no longer importable as StationType.EYE_HEALTH.

UPDATE "stations"
SET "is_active" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'EYE_HEALTH'
  AND "is_active" = true;

UPDATE "station_templates"
SET "active" = false,
    "station_type" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'EYE_HEALTH';
