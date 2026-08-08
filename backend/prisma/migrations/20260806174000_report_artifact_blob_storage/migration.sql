CREATE TABLE "report_artifact_blobs" (
  "storage_key" VARCHAR(500) PRIMARY KEY,
  "contents" BYTEA NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "report_artifact_blobs_created_at_idx" ON "report_artifact_blobs" ("created_at");
