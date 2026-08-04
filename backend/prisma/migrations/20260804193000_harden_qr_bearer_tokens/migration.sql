-- QR bearer tokens must not be retained in plaintext. Existing passes cannot be
-- encrypted safely in SQL because their encryption key never belongs to the
-- database, so active legacy passes are invalidated and must be reissued.
ALTER TABLE "qr_code_passes"
  ADD COLUMN "token_ciphertext" TEXT,
  ADD COLUMN "token_encryption_version" INTEGER NOT NULL DEFAULT 2;

UPDATE "qr_code_passes"
SET
  "is_active" = false,
  "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP),
  "revoked_reason" = COALESCE("revoked_reason", 'Legacy plaintext QR pass invalidated; reissue required')
WHERE "is_active" = true;

ALTER TABLE "qr_code_passes" DROP COLUMN "token";

DROP INDEX IF EXISTS "qr_code_passes_registration_id_is_active_idx";
CREATE INDEX "qr_code_passes_registration_id_is_active_expires_at_idx"
  ON "qr_code_passes"("registration_id", "is_active", "expires_at");
