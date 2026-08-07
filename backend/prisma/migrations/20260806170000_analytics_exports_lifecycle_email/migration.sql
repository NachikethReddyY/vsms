ALTER TYPE "ReportExportJobStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

CREATE TYPE "ReportExportFormat" AS ENUM ('PDF', 'CSV');
CREATE TYPE "ReportDataset" AS ENUM ('OVERVIEW', 'OPERATIONS', 'CLINICAL', 'REFERRALS');
CREATE TYPE "LifecycleEmailPurpose" AS ENUM (
  'SIGNUP_RECEIVED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REACTIVATED',
  'EVENT_ASSIGNMENT', 'PASSWORD_CHANGED'
);
CREATE TYPE "LifecycleEmailStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

ALTER TABLE "report_export_jobs"
  ADD COLUMN "requested_by" UUID,
  ADD COLUMN "dataset" "ReportDataset" NOT NULL DEFAULT 'OVERVIEW',
  ADD COLUMN "format" "ReportExportFormat" NOT NULL DEFAULT 'PDF',
  ADD COLUMN "filter_snapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "claim_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "failure_code" VARCHAR(80),
  ADD COLUMN "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "generated_at" TIMESTAMPTZ(3),
  ADD COLUMN "expires_at" TIMESTAMPTZ(3);

UPDATE "report_export_jobs" j
SET "requested_by" = e."created_by_user_id",
    "requested_at" = j."created_at",
    "expires_at" = j."created_at" + INTERVAL '7 days'
FROM "events" e
WHERE e."event_id" = j."event_id";

ALTER TABLE "report_export_jobs"
  ALTER COLUMN "requested_by" SET NOT NULL,
  ALTER COLUMN "expires_at" SET NOT NULL,
  ADD CONSTRAINT "report_export_jobs_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "report_export_jobs_attempt_bounds_check"
    CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempt_count" <= "max_attempts");

DROP INDEX IF EXISTS "report_export_jobs_event_id_status_idx";
CREATE INDEX "report_export_jobs_event_id_status_requested_at_idx"
  ON "report_export_jobs"("event_id", "status", "requested_at");
CREATE INDEX "report_export_jobs_status_next_attempt_at_lease_expires_at_idx"
  ON "report_export_jobs"("status", "next_attempt_at", "lease_expires_at");
CREATE INDEX "report_export_jobs_requested_by_requested_at_idx"
  ON "report_export_jobs"("requested_by", "requested_at");

CREATE TABLE "report_artifacts" (
  "report_artifact_id" UUID NOT NULL,
  "report_export_job_id" UUID NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_artifacts_pkey" PRIMARY KEY ("report_artifact_id"),
  CONSTRAINT "report_artifacts_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "report_artifacts_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "report_artifacts_report_export_job_id_fkey"
    FOREIGN KEY ("report_export_job_id") REFERENCES "report_export_jobs"("report_export_job_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "report_artifacts_report_export_job_id_key" ON "report_artifacts"("report_export_job_id");
CREATE UNIQUE INDEX "report_artifacts_storage_key_key" ON "report_artifacts"("storage_key");
CREATE INDEX "report_artifacts_expires_at_idx" ON "report_artifacts"("expires_at");

CREATE TABLE "lifecycle_email_outbox" (
  "lifecycle_email_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "purpose" "LifecycleEmailPurpose" NOT NULL,
  "provider" VARCHAR(40) NOT NULL DEFAULT 'GOOGLE_WORKSPACE',
  "template_version" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "idempotency_key" VARCHAR(180) NOT NULL,
  "status" "LifecycleEmailStatus" NOT NULL DEFAULT 'QUEUED',
  "claim_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider_message_id" VARCHAR(255),
  "failure_code" VARCHAR(80),
  "accepted_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "lifecycle_email_outbox_pkey" PRIMARY KEY ("lifecycle_email_id"),
  CONSTRAINT "lifecycle_email_outbox_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lifecycle_email_outbox_safe_metadata_check"
    CHECK (jsonb_typeof("metadata") = 'object' AND octet_length("metadata"::text) <= 4096),
  CONSTRAINT "lifecycle_email_outbox_attempt_bounds_check"
    CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempt_count" <= "max_attempts")
);
CREATE UNIQUE INDEX "lifecycle_email_outbox_idempotency_key_key" ON "lifecycle_email_outbox"("idempotency_key");
CREATE INDEX "lifecycle_email_outbox_status_next_attempt_at_lease_expires_at_idx"
  ON "lifecycle_email_outbox"("status", "next_attempt_at", "lease_expires_at");
CREATE INDEX "lifecycle_email_outbox_user_id_created_at_idx"
  ON "lifecycle_email_outbox"("user_id", "created_at");

-- Cover the event and time predicates used by bounded aggregate analytics.
CREATE INDEX "event_registrations_event_attendance_idx"
  ON "event_registrations"("event_id", "created_at")
  INCLUDE ("registration_status", "checked_in", "checked_in_at");
CREATE INDEX "queue_entries_station_entered_at_idx"
  ON "queue_entries"("station_id", "entered_at")
  INCLUDE ("status", "called_at", "started_at", "completed_at", "registration_id");
CREATE INDEX "screening_results_registration_created_at_idx"
  ON "screening_results"("registration_id", "created_at") INCLUDE ("overall_flag", "screening_type");
CREATE INDEX "reviews_registration_reviewed_at_idx"
  ON "reviews"("registration_id", "reviewed_at") INCLUDE ("outcome", "urgency");
CREATE INDEX "referrals_registration_created_at_idx"
  ON "referrals"("registration_id", "created_at") INCLUDE ("status", "urgency");

ALTER TABLE "artifact_cleanup_tasks" DROP CONSTRAINT IF EXISTS "artifact_cleanup_tasks_artifact_type_check";
ALTER TABLE "artifact_cleanup_tasks" ADD CONSTRAINT "artifact_cleanup_tasks_artifact_type_check"
  CHECK ("artifact_type" IN ('CONSENT_SIGNATURE', 'REFERRAL_SIGNATURE', 'REVIEW_DECISION_SIGNATURE', 'REFERRAL_DOCUMENT', 'REPORT_EXPORT'));
