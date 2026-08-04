ALTER TYPE "SignaturePurpose"
  ADD VALUE IF NOT EXISTS 'REVIEW_DECISION';

ALTER TABLE "reviews"
  ADD COLUMN "signature_object_key" VARCHAR(500),
  ADD COLUMN "signature_sha256" CHAR(64),
  ADD COLUMN "signature_mime_type" VARCHAR(100),
  ADD COLUMN "signature_signer_user_id" UUID,
  ADD COLUMN "signed_payload_hash" CHAR(64),
  ADD COLUMN "signed_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "reviews_signature_object_key_key"
  ON "reviews"("signature_object_key");
CREATE INDEX "reviews_signature_signer_user_id_signed_at_idx"
  ON "reviews"("signature_signer_user_id", "signed_at");

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_signature_signer_user_id_fkey"
  FOREIGN KEY ("signature_signer_user_id") REFERENCES "users"("user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_signature_metadata_complete_check"
  CHECK (
    ("signature_object_key" IS NULL
      AND "signature_sha256" IS NULL
      AND "signature_mime_type" IS NULL
      AND "signature_signer_user_id" IS NULL
      AND "signed_payload_hash" IS NULL
      AND "signed_at" IS NULL)
    OR
    ("signature_object_key" IS NOT NULL
      AND "signature_sha256" IS NOT NULL
      AND "signature_mime_type" IS NOT NULL
      AND "signature_signer_user_id" IS NOT NULL
      AND "signed_payload_hash" IS NOT NULL
      AND "signed_at" IS NOT NULL)
  );
