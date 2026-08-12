-- Append-only QR pass lifecycle ledger. The qr_id, registration_id, and
-- event_id_ref columns intentionally have NO foreign key constraints so the
-- ledger survives downstream cascade deletes of registrations and events.
CREATE TYPE "QRPassEventAction" AS ENUM ('ISSUED', 'ROTATED', 'REISSUED', 'VERIFIED', 'REVOKED', 'EXPIRED');

CREATE TABLE "qr_pass_events" (
    "event_id" UUID NOT NULL,
    "qr_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "event_id_ref" UUID NOT NULL,
    "action" "QRPassEventAction" NOT NULL,
    "actor_user_id" UUID,
    "correlation_id" UUID NOT NULL,
    "ip_address" VARCHAR(45),
    "device_name" VARCHAR(100),
    "reason" VARCHAR(255),
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qr_pass_events_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "qr_pass_events_qr_id_occurred_at_idx" ON "qr_pass_events"("qr_id", "occurred_at");
CREATE INDEX "qr_pass_events_registration_id_occurred_at_idx" ON "qr_pass_events"("registration_id", "occurred_at");
CREATE INDEX "qr_pass_events_event_id_action_occurred_at_idx" ON "qr_pass_events"("event_id_ref", "action", "occurred_at");
CREATE INDEX "qr_pass_events_correlation_id_idx" ON "qr_pass_events"("correlation_id");

ALTER TABLE "qr_pass_events"
    ADD CONSTRAINT "qr_pass_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;

-- Immutability guard: the ledger is append-only and rejects UPDATE/DELETE.
CREATE OR REPLACE FUNCTION "prevent_qr_pass_event_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'qr_pass_events is an append-only ledger and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "prevent_qr_pass_event_mutation"
BEFORE UPDATE OR DELETE ON "qr_pass_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_qr_pass_event_mutation"();
