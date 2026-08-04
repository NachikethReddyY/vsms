ALTER TABLE "notification_deliveries"
ADD CONSTRAINT "notification_deliveries_recipient_masked_check"
CHECK ("recipient" ~ '^[^@][*]{3}@[^@]+$') NOT VALID;

-- Existing rows are validated only after scripts/backfill-encryption-v2.js has
-- re-encrypted legacy values with record-bound AAD and masked the display field.
