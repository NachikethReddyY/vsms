-- Ambiguous provider responses must never be retried automatically.
ALTER TYPE "NotificationDeliveryStatus"
  ADD VALUE IF NOT EXISTS 'RECONCILIATION_REQUIRED';

-- Durable filesystem cleanup outbox. Deliberately no event foreign key: these
-- rows must survive the event hard-delete transaction they accompany.
CREATE TABLE "artifact_cleanup_tasks" (
  "cleanup_task_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "artifact_type" VARCHAR(40) NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(255),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "artifact_cleanup_tasks_pkey" PRIMARY KEY ("cleanup_task_id"),
  CONSTRAINT "artifact_cleanup_tasks_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'FAILED', 'ESCALATED', 'COMPLETED', 'RESOLVED')),
  CONSTRAINT "artifact_cleanup_tasks_artifact_type_check"
    CHECK ("artifact_type" IN ('CONSENT_SIGNATURE', 'REFERRAL_SIGNATURE', 'REFERRAL_DOCUMENT'))
);

CREATE UNIQUE INDEX "artifact_cleanup_tasks_event_id_artifact_type_storage_key_key"
  ON "artifact_cleanup_tasks"("event_id", "artifact_type", "storage_key");
CREATE INDEX "artifact_cleanup_tasks_status_next_attempt_at_idx"
  ON "artifact_cleanup_tasks"("status", "next_attempt_at");
CREATE INDEX "artifact_cleanup_tasks_event_id_status_idx"
  ON "artifact_cleanup_tasks"("event_id", "status");

-- A generated document path is an object identity and must not be shared by
-- records from different events.
CREATE UNIQUE INDEX "document_artifacts_storage_key_key"
  ON "document_artifacts"("storage_key");

-- Normalize stale and duplicate rows before enforcing the invariant. Validity
-- still requires expiry > now in application queries; is_active is the durable
-- database ownership slot.
UPDATE "qr_code_passes"
SET
  "is_active" = false,
  "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP),
  "revoked_reason" = COALESCE("revoked_reason", 'Expired QR pass normalized before active uniqueness enforcement')
WHERE "is_active" = true
  AND ("expires_at" IS NULL OR "expires_at" <= CURRENT_TIMESTAMP);

WITH ranked_active AS (
  SELECT
    "qr_id",
    ROW_NUMBER() OVER (
      PARTITION BY "registration_id"
      ORDER BY "issued_at" DESC, "qr_id" DESC
    ) AS active_rank
  FROM "qr_code_passes"
  WHERE "is_active" = true
)
UPDATE "qr_code_passes" AS qr
SET
  "is_active" = false,
  "revoked_at" = COALESCE(qr."revoked_at", CURRENT_TIMESTAMP),
  "revoked_reason" = COALESCE(qr."revoked_reason", 'Duplicate active QR pass normalized before uniqueness enforcement')
FROM ranked_active
WHERE qr."qr_id" = ranked_active."qr_id"
  AND ranked_active.active_rank > 1;

CREATE UNIQUE INDEX "qr_code_passes_one_active_per_registration_key"
  ON "qr_code_passes"("registration_id")
  WHERE "is_active" = true;
