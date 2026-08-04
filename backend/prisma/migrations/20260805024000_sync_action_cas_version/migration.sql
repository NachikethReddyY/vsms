ALTER TABLE "sync_actions"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processing_started_at" TIMESTAMPTZ(3);
