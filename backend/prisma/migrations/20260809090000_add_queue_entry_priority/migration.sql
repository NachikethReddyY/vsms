ALTER TABLE "queue_entries"
ADD COLUMN "is_priority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priority_notes" VARCHAR(255);

CREATE INDEX "queue_entries_station_id_status_is_priority_idx"
ON "queue_entries"("station_id", "status", "is_priority");
