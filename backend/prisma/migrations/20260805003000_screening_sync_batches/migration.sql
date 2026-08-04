-- Sync actions retain only safe operational metadata. Remove any legacy free-form
-- error text before converting the column to an allowlisted error code.
UPDATE "sync_actions" SET "error_log" = NULL;
ALTER TABLE "sync_actions" RENAME COLUMN "error_log" TO "error_code";
ALTER TABLE "sync_actions" ALTER COLUMN "error_code" TYPE VARCHAR(64);

ALTER TABLE "sync_actions"
  ADD COLUMN "event_id" UUID,
  ADD COLUMN "station_id" UUID,
  ADD COLUMN "client_action_id" UUID,
  ADD COLUMN "request_fingerprint" CHAR(64),
  ADD COLUMN "response_snapshot" JSONB;

CREATE UNIQUE INDEX "sync_actions_user_id_client_action_id_key"
  ON "sync_actions"("user_id", "client_action_id");
CREATE INDEX "sync_actions_event_id_status_created_at_idx"
  ON "sync_actions"("event_id", "status", "created_at");
CREATE INDEX "sync_actions_station_id_status_idx"
  ON "sync_actions"("station_id", "status");

CREATE TABLE "sync_action_transitions" (
  "sync_transition_id" UUID NOT NULL,
  "sync_action_id" UUID NOT NULL,
  "status" "SyncActionStatus" NOT NULL,
  "retry_count" INTEGER NOT NULL,
  "error_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_action_transitions_pkey" PRIMARY KEY ("sync_transition_id")
);

ALTER TABLE "sync_action_transitions"
  ADD CONSTRAINT "sync_action_transitions_sync_action_id_fkey"
  FOREIGN KEY ("sync_action_id") REFERENCES "sync_actions"("sync_action_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "sync_action_transitions_sync_action_id_created_at_idx"
  ON "sync_action_transitions"("sync_action_id", "created_at");
CREATE INDEX "sync_action_transitions_status_created_at_idx"
  ON "sync_action_transitions"("status", "created_at");
