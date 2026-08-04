CREATE TYPE "SignaturePurpose" AS ENUM ('CONSENT', 'REFERRAL');

CREATE TABLE "signature_artifacts" (
  "signature_artifact_id" UUID NOT NULL,
  "signature_object_key" VARCHAR(500) NOT NULL,
  "signature_sha256" CHAR(64) NOT NULL,
  "signature_mime_type" VARCHAR(100) NOT NULL,
  "user_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "purpose" "SignaturePurpose" NOT NULL,
  "target_id" UUID NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signature_artifacts_pkey" PRIMARY KEY ("signature_artifact_id")
);

CREATE UNIQUE INDEX "signature_artifacts_signature_object_key_key" ON "signature_artifacts"("signature_object_key");
CREATE INDEX "signature_artifacts_user_id_event_id_purpose_target_id_consumed_at_idx"
  ON "signature_artifacts"("user_id", "event_id", "purpose", "target_id", "consumed_at");

ALTER TABLE "signature_artifacts"
  ADD CONSTRAINT "signature_artifacts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "signature_artifacts_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;
