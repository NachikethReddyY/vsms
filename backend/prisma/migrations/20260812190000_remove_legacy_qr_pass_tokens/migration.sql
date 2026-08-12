-- Legacy event-registration tokens bypass secure-pass expiry and revocation.
-- Clear them before the application removes the fallback credential path.
UPDATE "event_registrations"
SET "pass_token" = NULL
WHERE "pass_token" IS NOT NULL;

-- Any active row that cannot be securely rendered must be reissued by the
-- authenticated maintenance command after deployment.
UPDATE "qr_code_passes"
SET
  "is_active" = false,
  "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP),
  "revoked_reason" = COALESCE("revoked_reason", 'Secure QR reissue required')
WHERE "is_active" = true
  AND (
    "revoked_at" IS NOT NULL
    OR "expires_at" IS NULL
    OR "expires_at" <= CURRENT_TIMESTAMP
    OR "token_hash" IS NULL
    OR "token_ciphertext" IS NULL
    OR "token_encryption_version" <> 2
  );
