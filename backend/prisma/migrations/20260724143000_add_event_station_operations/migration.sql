-- Station templates are reusable definitions. Event stations copy the
-- operational fields so event-specific ordering/capacity never mutates them.
CREATE TABLE "station_templates" (
    "station_template_id" UUID NOT NULL,
    "template_key" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "default_capacity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_templates_pkey" PRIMARY KEY ("station_template_id"),
    CONSTRAINT "station_templates_version_check" CHECK ("version" > 0),
    CONSTRAINT "station_templates_capacity_check" CHECK ("default_capacity" BETWEEN 1 AND 1000)
);

CREATE TABLE "event_stations" (
    "event_station_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "station_template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "station_order" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_stations_pkey" PRIMARY KEY ("event_station_id"),
    CONSTRAINT "event_stations_template_version_check" CHECK ("template_version" > 0),
    CONSTRAINT "event_stations_order_check" CHECK ("station_order" BETWEEN 1 AND 51),
    CONSTRAINT "event_stations_capacity_check" CHECK ("capacity" BETWEEN 1 AND 1000)
);

CREATE UNIQUE INDEX "station_templates_template_key_version_key" ON "station_templates"("template_key", "version");
CREATE INDEX "station_templates_active_name_idx" ON "station_templates"("active", "name");
CREATE UNIQUE INDEX "event_stations_event_id_station_template_id_key" ON "event_stations"("event_id", "station_template_id");
CREATE UNIQUE INDEX "event_stations_event_id_station_order_key" ON "event_stations"("event_id", "station_order");
CREATE INDEX "event_stations_event_id_is_available_idx" ON "event_stations"("event_id", "is_available");

ALTER TABLE "event_stations"
  ADD CONSTRAINT "event_stations_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_stations"
  ADD CONSTRAINT "event_stations_station_template_id_fkey"
  FOREIGN KEY ("station_template_id") REFERENCES "station_templates"("station_template_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy station UUIDs had no referenced table, so they cannot safely point
-- at the new event-owned station snapshots.
UPDATE "staff_assignments"
SET "event_station_id" = NULL
WHERE "event_station_id" IS NOT NULL;

-- The old nullable three-column key allowed more than one row per shift/user.
-- Keep the most relevant, most recently updated assignment before tightening it.
WITH "ranked_assignments" AS (
  SELECT
    "staff_assignment_id",
    ROW_NUMBER() OVER (
      PARTITION BY "shift_id", "user_id"
      ORDER BY
        CASE "status"
          WHEN 'CONFIRMED' THEN 0
          WHEN 'ASSIGNED' THEN 1
          ELSE 2
        END,
        "updated_at" DESC,
        "staff_assignment_id"
    ) AS "duplicate_rank"
  FROM "staff_assignments"
)
DELETE FROM "staff_assignments"
WHERE "staff_assignment_id" IN (
  SELECT "staff_assignment_id"
  FROM "ranked_assignments"
  WHERE "duplicate_rank" > 1
);

DROP INDEX "staff_assignments_shift_id_user_id_event_station_id_key";
CREATE UNIQUE INDEX "staff_assignments_shift_id_user_id_key" ON "staff_assignments"("shift_id", "user_id");

ALTER TABLE "staff_assignments"
  ADD CONSTRAINT "staff_assignments_event_station_id_fkey"
  FOREIGN KEY ("event_station_id") REFERENCES "event_stations"("event_station_id") ON DELETE SET NULL ON UPDATE CASCADE;
