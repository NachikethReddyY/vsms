ALTER TYPE "NotificationDeliveryStatus"
  ADD VALUE IF NOT EXISTS 'COMPLAINT';

ALTER TABLE "referrals"
  ADD COLUMN "revision_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedes_referral_id" UUID,
  ADD COLUMN "revision_idempotency_key" VARCHAR(100),
  ADD COLUMN "revision_request_fingerprint" CHAR(64);

WITH ranked_referrals AS (
  SELECT
    "referral_id",
    ROW_NUMBER() OVER (
      PARTITION BY "review_id"
      ORDER BY "created_at", "referral_id"
    ) AS revision_number
  FROM "referrals"
)
UPDATE "referrals" AS referral
SET "revision_number" = ranked_referrals.revision_number
FROM ranked_referrals
WHERE referral."referral_id" = ranked_referrals."referral_id";

CREATE UNIQUE INDEX "referrals_review_id_revision_number_key"
  ON "referrals"("review_id", "revision_number");
CREATE UNIQUE INDEX "referrals_supersedes_referral_id_key"
  ON "referrals"("supersedes_referral_id");
CREATE UNIQUE INDEX "referrals_revision_idempotency_key_key"
  ON "referrals"("revision_idempotency_key");
ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_supersedes_referral_id_fkey"
  FOREIGN KEY ("supersedes_referral_id") REFERENCES "referrals"("referral_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "provider_event_receipts" (
  "provider_event_receipt_id" UUID NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "provider_event_id" VARCHAR(255) NOT NULL,
  "provider_message_id_hash" CHAR(64) NOT NULL,
  "delivery_id" UUID,
  "event_type" VARCHAR(40) NOT NULL,
  "applied_status" VARCHAR(40),
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_event_receipts_pkey" PRIMARY KEY ("provider_event_receipt_id")
);

CREATE UNIQUE INDEX "provider_event_receipts_provider_event_id_key"
  ON "provider_event_receipts"("provider_event_id");
CREATE INDEX "provider_event_receipts_delivery_id_received_at_idx"
  ON "provider_event_receipts"("delivery_id", "received_at");
CREATE INDEX "provider_event_receipts_provider_message_id_hash_received_at_idx"
  ON "provider_event_receipts"("provider_message_id_hash", "received_at");
