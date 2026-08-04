ALTER TABLE "screening_results"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "screening_request_ledger" (
  "request_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(64) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "registration_id" UUID NOT NULL,
  "station_id" UUID NOT NULL,
  "result_id" UUID NOT NULL,
  "result_version" INTEGER NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "screening_request_ledger_pkey" PRIMARY KEY ("request_id")
);

CREATE UNIQUE INDEX "screening_request_ledger_idempotency_key_key"
ON "screening_request_ledger"("idempotency_key");

CREATE INDEX "screening_request_ledger_actor_user_id_event_id_registration_id_station_id_idx"
ON "screening_request_ledger"("actor_user_id", "event_id", "registration_id", "station_id");

CREATE INDEX "screening_request_ledger_result_id_result_version_idx"
ON "screening_request_ledger"("result_id", "result_version");

ALTER TABLE "screening_request_ledger"
ADD CONSTRAINT "screening_request_ledger_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "screening_request_ledger"
ADD CONSTRAINT "screening_request_ledger_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screening_request_ledger"
ADD CONSTRAINT "screening_request_ledger_registration_id_fkey"
FOREIGN KEY ("registration_id") REFERENCES "event_registrations"("registration_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screening_request_ledger"
ADD CONSTRAINT "screening_request_ledger_station_id_fkey"
FOREIGN KEY ("station_id") REFERENCES "stations"("station_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "screening_request_ledger"
ADD CONSTRAINT "screening_request_ledger_result_id_fkey"
FOREIGN KEY ("result_id") REFERENCES "screening_results"("result_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing rows are intentionally not promoted into immutable receipts: their
-- original acknowledged input is unavailable, so replay must remain fail-closed.
