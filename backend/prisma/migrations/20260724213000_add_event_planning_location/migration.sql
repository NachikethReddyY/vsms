ALTER TABLE "events"
  ADD COLUMN "address" VARCHAR(500),
  ADD COLUMN "postal_code" VARCHAR(6),
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "location_provider" VARCHAR(20),
  ADD COLUMN "location_reference" VARCHAR(255),
  ADD COLUMN "expected_attendance" INTEGER,
  ADD COLUMN "create_idempotency_key" VARCHAR(100),
  ADD COLUMN "create_payload_hash" CHAR(64);

CREATE UNIQUE INDEX "events_created_by_user_id_create_idempotency_key_key"
  ON "events"("created_by_user_id", "create_idempotency_key");

ALTER TABLE "events"
  ADD CONSTRAINT "events_expected_attendance_check"
    CHECK ("expected_attendance" IS NULL OR "expected_attendance" BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "events_location_pair_check"
    CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)),
  ADD CONSTRAINT "events_location_provider_check"
    CHECK ("location_provider" IS NULL OR "location_provider" IN ('ONEMAP', 'MANUAL'));

CREATE TABLE "event_days" (
  "event_day_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_days_pkey" PRIMARY KEY ("event_day_id"),
  CONSTRAINT "event_days_range_check" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "event_days_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "event_days_event_id_date_key" ON "event_days"("event_id", "date");
CREATE INDEX "event_days_event_id_starts_at_idx" ON "event_days"("event_id", "starts_at");

INSERT INTO "event_days" ("event_id", "date", "starts_at", "ends_at")
SELECT
  event."event_id",
  local_day::date,
  GREATEST(event."starts_at", local_day AT TIME ZONE event."timezone"),
  LEAST(event."ends_at", (local_day + INTERVAL '1 day') AT TIME ZONE event."timezone")
FROM "events" event
CROSS JOIN LATERAL generate_series(
  (event."starts_at" AT TIME ZONE event."timezone")::date,
  ((event."ends_at" - INTERVAL '1 millisecond') AT TIME ZONE event."timezone")::date,
  INTERVAL '1 day'
) AS local_day;

CREATE TABLE "event_station_availabilities" (
  "event_station_availability_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_station_id" UUID NOT NULL,
  "event_day_id" UUID NOT NULL,
  "is_available" BOOLEAN NOT NULL DEFAULT true,
  "starts_at" TIMESTAMPTZ(3),
  "ends_at" TIMESTAMPTZ(3),
  "capacity" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_station_availabilities_pkey" PRIMARY KEY ("event_station_availability_id"),
  CONSTRAINT "event_station_availabilities_capacity_check" CHECK ("capacity" BETWEEN 1 AND 100000),
  CONSTRAINT "event_station_availabilities_range_check" CHECK (
    ("is_available" = false AND "starts_at" IS NULL AND "ends_at" IS NULL)
    OR
    ("is_available" = true AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL AND "starts_at" < "ends_at")
  ),
  CONSTRAINT "event_station_availabilities_station_fkey" FOREIGN KEY ("event_station_id") REFERENCES "event_stations"("event_station_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_station_availabilities_day_fkey" FOREIGN KEY ("event_day_id") REFERENCES "event_days"("event_day_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "event_station_availabilities_station_day_key"
  ON "event_station_availabilities"("event_station_id", "event_day_id");
CREATE INDEX "event_station_availabilities_day_available_idx"
  ON "event_station_availabilities"("event_day_id", "is_available");

INSERT INTO "event_station_availabilities" (
  "event_station_id",
  "event_day_id",
  "is_available",
  "starts_at",
  "ends_at",
  "capacity"
)
SELECT
  station."event_station_id",
  day."event_day_id",
  station."is_available",
  CASE WHEN station."is_available" THEN day."starts_at" ELSE NULL END,
  CASE WHEN station."is_available" THEN day."ends_at" ELSE NULL END,
  station."capacity"
FROM "event_stations" station
JOIN "event_days" day ON day."event_id" = station."event_id";
