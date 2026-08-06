-- Completed or cancelled duties are historical scheduling facts, not an event
-- membership removal. Reactivate only rows that the prior backfill marked.
UPDATE "event_memberships"
SET "status" = 'ACTIVE'::"EventMembershipStatus",
    "removed_by" = NULL,
    "removed_at" = NULL,
    "removal_reason" = NULL
WHERE "status" = 'REMOVED'::"EventMembershipStatus"
  AND "removal_reason" = 'Historical duties completed or cancelled before membership migration';

CREATE TYPE "ReportExportJobStatus" AS ENUM (
  'QUEUED',
  'GENERATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "report_export_jobs" (
  "report_export_job_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "status" "ReportExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "report_export_jobs_pkey" PRIMARY KEY ("report_export_job_id")
);

CREATE INDEX "report_export_jobs_event_id_status_idx"
  ON "report_export_jobs"("event_id", "status");

ALTER TABLE "report_export_jobs"
  ADD CONSTRAINT "report_export_jobs_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("event_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
