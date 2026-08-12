ALTER TABLE "event_registrations"
ADD COLUMN "route_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "event_registrations"
ADD CONSTRAINT "event_registrations_route_version_check" CHECK ("route_version" > 0);

CREATE TABLE "registration_route_steps" (
  "route_step_id" UUID NOT NULL,
  "registration_id" UUID NOT NULL,
  "station_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "registration_route_steps_pkey" PRIMARY KEY ("route_step_id"),
  CONSTRAINT "registration_route_steps_position_check" CHECK ("position" > 0),
  CONSTRAINT "registration_route_steps_registration_id_fkey"
    FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registration_route_steps_station_id_fkey"
    FOREIGN KEY ("station_id") REFERENCES "stations"("station_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_route_steps_registration_id_position_key"
ON "registration_route_steps"("registration_id", "position");

CREATE UNIQUE INDEX "registration_route_steps_registration_id_station_id_key"
ON "registration_route_steps"("registration_id", "station_id");

CREATE INDEX "registration_route_steps_station_id_completed_at_idx"
ON "registration_route_steps"("station_id", "completed_at");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "queue_entries"
    WHERE "status" IN ('WAITING', 'CALLED', 'IN_PROGRESS')
    GROUP BY "registration_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active queue entry: duplicate active registrations require audited reconciliation';
  END IF;
END $$;

CREATE UNIQUE INDEX "queue_entries_one_active_registration_key"
ON "queue_entries"("registration_id")
WHERE "status" IN ('WAITING', 'CALLED', 'IN_PROGRESS');
