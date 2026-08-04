ALTER TABLE "notification_deliveries"
ADD COLUMN "request_fingerprint" CHAR(64),
ADD COLUMN "handoff_secret_ciphertext" TEXT,
ADD COLUMN "handoff_secret_expires_at" TIMESTAMPTZ(3),
ADD COLUMN "handoff_secret_acknowledged_at" TIMESTAMPTZ(3);

CREATE INDEX "notification_deliveries_handoff_secret_expires_at_idx"
ON "notification_deliveries"("handoff_secret_expires_at");
