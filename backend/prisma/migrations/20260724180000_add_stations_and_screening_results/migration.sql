-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('VISUAL_ACUITY', 'REFRACTION', 'COLOUR_VISION', 'EYE_HEALTH');

-- CreateEnum
CREATE TYPE "OverallFlag" AS ENUM ('NORMAL', 'REVIEW', 'REFER', 'URGENT');

-- AlterTable
ALTER TABLE "event_registrations" ADD COLUMN IF NOT EXISTS "participant_display_name" VARCHAR(150);
ALTER TABLE "event_registrations" ADD COLUMN IF NOT EXISTS "queue_number" INTEGER;
ALTER TABLE "event_registrations" ADD COLUMN IF NOT EXISTS "pass_token" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "event_registrations_pass_token_key" ON "event_registrations"("pass_token");

-- CreateTable
CREATE TABLE IF NOT EXISTS "stations" (
    "station_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "station_name" VARCHAR(100) NOT NULL,
    "station_type" "StationType" NOT NULL,
    "station_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("station_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "screening_results" (
    "result_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "screening_type" "StationType" NOT NULL,
    "result_data" JSONB NOT NULL,
    "overall_flag" "OverallFlag" NOT NULL DEFAULT 'NORMAL',
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_summary" TEXT,
    "rule_version" VARCHAR(20) NOT NULL DEFAULT 'VSMS-VA-1.0',
    "acknowledged_at" TIMESTAMPTZ(3),
    "idempotency_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "screening_results_pkey" PRIMARY KEY ("result_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stations_event_id_station_type_key" ON "stations"("event_id", "station_type");
CREATE UNIQUE INDEX IF NOT EXISTS "stations_event_id_station_order_key" ON "stations"("event_id", "station_order");
CREATE INDEX IF NOT EXISTS "stations_event_id_is_active_idx" ON "stations"("event_id", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "screening_results_idempotency_key_key" ON "screening_results"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "screening_results_registration_id_station_id_key" ON "screening_results"("registration_id", "station_id");
CREATE INDEX IF NOT EXISTS "screening_results_station_id_is_flagged_idx" ON "screening_results"("station_id", "is_flagged");
CREATE INDEX IF NOT EXISTS "screening_results_overall_flag_idx" ON "screening_results"("overall_flag");
CREATE INDEX IF NOT EXISTS "screening_results_recorded_by_user_id_idx" ON "screening_results"("recorded_by_user_id");

DO $$ BEGIN
  ALTER TABLE "stations" ADD CONSTRAINT "stations_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_registration_id_fkey"
    FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_station_id_fkey"
    FOREIGN KEY ("station_id") REFERENCES "stations"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_recorded_by_user_id_fkey"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
