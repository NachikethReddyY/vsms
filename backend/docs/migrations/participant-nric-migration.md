# Participant NRIC encryption migration

VSMS uses a staged migration so existing participant lookup remains available while plaintext NRIC rows are converted to record-bound AES-256-GCM ciphertext.

## Deployment sequence

1. Create a dedicated, stable 256-bit hexadecimal secret for `PARTICIPANT_LOOKUP_HMAC_KEY`. Do not reuse the JWT or AES encryption keys.
2. Deploy migration `20260813040000_encrypt_participant_nric`. It adds ciphertext, blind-index, and encryption-version columns without dropping legacy data.
3. Deploy the application. New and updated participants now write `nric = NULL`, authenticated ciphertext, a keyed blind index, and the masked display value. Reads remain compatible with legacy rows during this release.
4. Run `pnpm --dir backend nric:backfill` as an audited one-off task with the production encryption keyring and participant lookup key available.
5. Confirm the command reports zero legacy and zero incomplete rows. Independently verify:

   ```sql
   SELECT
     COUNT(*) FILTER (WHERE nric IS NOT NULL) AS legacy_plaintext_rows,
     COUNT(*) FILTER (
       WHERE nric_ciphertext IS NULL
          OR nric_lookup_hash IS NULL
          OR nric_encryption_version <> 2
     ) AS incomplete_encrypted_rows
   FROM participants;
   ```

6. Retain the compatibility read for one release. A later migration may remove the `nric` column only after backups, restore validation, and production verification are complete.

## Safety properties

- Ciphertext is bound to the participant UUID through authenticated additional data.
- The blind index is an HMAC, not a raw hash; enumerating the small NRIC space requires possession of the lookup key.
- API projections remove plaintext, ciphertext, lookup hashes, and encryption metadata.
- The backfill uses conditional updates and aborts if a participant changes concurrently.
- Logs and audit records contain only masked values or migration counts.

## Rollback

Do not drop or rotate either key during rollback. The additive schema can remain deployed and the prior application version may be restored **only before the backfill begins**. After any row is converted, the prior release cannot match that participant because its plaintext column is null; from that point recovery is a roll-forward to this release. Rehearse backup restoration and application rollback before running the production backfill.
