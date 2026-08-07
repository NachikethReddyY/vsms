-- Forward-only report publication reservation. A claim-specific final key is
-- durable before it is published, so lease recovery can always clean it up.
ALTER TABLE "report_export_jobs"
  ADD COLUMN IF NOT EXISTS "publication_storage_key" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "publication_claim_token" UUID;

CREATE INDEX IF NOT EXISTS "report_export_jobs_publication_claim_token_idx"
  ON "report_export_jobs"("publication_claim_token");
