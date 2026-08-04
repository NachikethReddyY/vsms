ALTER TYPE "NotificationDeliveryStatus" ADD VALUE IF NOT EXISTS 'SENT';

ALTER TABLE "referrals"
ADD COLUMN "signature_object_key" VARCHAR(500),
ADD COLUMN "signature_sha256" CHAR(64),
ADD COLUMN "signature_mime_type" VARCHAR(100),
ADD COLUMN "signed_payload_hash" CHAR(64),
ADD COLUMN "signed_at" TIMESTAMPTZ(3);

ALTER TABLE "notification_deliveries"
ADD COLUMN "document_id" UUID,
ADD COLUMN "recipient_ciphertext" TEXT,
ADD COLUMN "provider_message_id" VARCHAR(255),
ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN "idempotency_key" VARCHAR(100),
ADD COLUMN "delivered_at" TIMESTAMPTZ(3),
ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "document_artifacts_review_id_document_type_version_key"
ON "document_artifacts"("review_id", "document_type", "version");
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key"
ON "notification_deliveries"("idempotency_key");
CREATE INDEX "notification_deliveries_document_id_idx"
ON "notification_deliveries"("document_id");
CREATE INDEX "notification_deliveries_status_created_at_idx"
ON "notification_deliveries"("status", "created_at");

ALTER TABLE "notification_deliveries"
ADD CONSTRAINT "notification_deliveries_document_id_fkey"
FOREIGN KEY ("document_id") REFERENCES "document_artifacts"("document_id")
ON DELETE SET NULL ON UPDATE CASCADE;
