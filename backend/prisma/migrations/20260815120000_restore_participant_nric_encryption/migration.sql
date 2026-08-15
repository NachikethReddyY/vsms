-- Restore the application-layer encryption fields removed by
-- 20260813102500_final_database while the seed, participant service, and
-- encryption backfill still depend on them.
ALTER TABLE "participants"
ADD COLUMN "nric_ciphertext" TEXT,
ADD COLUMN "nric_lookup_hash" CHAR(64),
ADD COLUMN "nric_encryption_version" INTEGER;

CREATE UNIQUE INDEX "participants_nric_lookup_hash_key"
ON "participants"("nric_lookup_hash");

ALTER TABLE "participants"
ADD CONSTRAINT "participants_encrypted_nric_shape_check"
CHECK (
  ("nric_ciphertext" IS NULL AND "nric_lookup_hash" IS NULL AND "nric_encryption_version" IS NULL)
  OR
  ("nric_ciphertext" IS NOT NULL AND "nric_lookup_hash" IS NOT NULL AND "nric_encryption_version" = 2 AND "nric" IS NULL)
);

COMMENT ON COLUMN "participants"."nric" IS
'Legacy plaintext compatibility column. Run pnpm nric:backfill, verify zero legacy rows, then remove in a later deployment.';
