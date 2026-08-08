-- Forward-only Stage 3 hardening. The two preceding Stage 3 migrations may
-- already be applied, so their checksums remain untouched.
ALTER TYPE "LifecycleEmailPurpose" ADD VALUE IF NOT EXISTS 'DEPROVISIONED';
ALTER TYPE "LifecycleEmailStatus" ADD VALUE IF NOT EXISTS 'RECONCILIATION_REQUIRED';
ALTER TYPE "LifecycleEmailStatus" ADD VALUE IF NOT EXISTS 'ESCALATED';

-- Legacy deletion-blocker rows did not have a requester. They can never be
-- safely generated, so retain them as terminal audit evidence under the
-- event creator before restoring the invariant.
UPDATE "report_export_jobs" j
SET "requested_by" = e."created_by_user_id",
    "status" = 'CANCELLED',
    "failure_code" = COALESCE(j."failure_code", 'LEGACY_REQUESTER_MISSING'),
    "claim_token" = NULL,
    "lease_expires_at" = NULL
FROM "events" e
WHERE j."event_id" = e."event_id" AND j."requested_by" IS NULL;

ALTER TABLE "report_export_jobs" ALTER COLUMN "requested_by" SET NOT NULL;

-- A crashed legacy worker left these rows with no recoverable lease. Requeue
-- only rows with a requester; terminal expiry is handled by the worker.
UPDATE "report_export_jobs"
SET "status" = 'QUEUED', "claim_token" = NULL, "lease_expires_at" = NULL,
    "next_attempt_at" = CURRENT_TIMESTAMP,
    "failure_code" = COALESCE("failure_code", 'LEGACY_GENERATING_RECOVERED')
WHERE "status" = 'GENERATING' AND "lease_expires_at" IS NULL;

-- Queue analytics scopes stations by event and throughput by completion time.
CREATE INDEX IF NOT EXISTS "stations_event_id_station_id_idx"
  ON "stations"("event_id", "station_id");
CREATE INDEX IF NOT EXISTS "queue_entries_station_completed_at_idx"
  ON "queue_entries"("station_id", "completed_at")
  INCLUDE ("status", "started_at", "called_at", "registration_id");
