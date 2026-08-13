# Encryption key rotation

Referral delivery recipients and temporary PDF handoff passphrases use AES-256-GCM envelopes in this form:

`v2:<key-id>:<iv>:<authentication-tag>:<ciphertext>`

The authenticated data binds each value to its `NotificationDelivery` ID and field name. Moving ciphertext between records or between the recipient and passphrase fields fails authentication.

## Production configuration

Production startup requires both variables and fails before serving traffic if either is invalid:

```text
ENCRYPTION_ACTIVE_KEY_ID=current
ENCRYPTION_KEYRING_JSON={"previous":"<64 hex characters>","current":"<64 hex characters>"}
```

Participant NRIC lookup uses the separate `PARTICIPANT_LOOKUP_HMAC_KEY`. Do not rotate that key as part of routine AES envelope rotation: changing it requires an audited re-index of every encrypted NRIC before traffic moves to the new key.

Key IDs must contain only letters, numbers, `_`, or `-`. Keys must be unique 256-bit hexadecimal values. Keep `ENCRYPTION_KEY` temporarily during the legacy backfill if old three-part ciphertext was encrypted with it; remove it after the backfill succeeds.

## Deployment and rotation

1. Back up the database and deploy the schema migration with the recipient check constraint marked `NOT VALID`.
2. Deploy the complete keyring with the old key retained and set the desired write key as `ENCRYPTION_ACTIVE_KEY_ID`.
3. Preview without changing data: `pnpm exec node scripts/backfill-encryption-v2.js`.
4. Apply the audited backfill: `pnpm exec node scripts/backfill-encryption-v2.js --apply`.
5. Confirm the script reports `constraintValidated: true`, then remove retired keys in a later deployment.

The apply mode re-encrypts legacy or retired-key ciphertext with the active key, masks the display-only recipient, and writes one `ENCRYPTION_BACKFILL_APPLIED` audit entry per delivery. It never prints plaintext, passwords, recipients, or encryption keys. The command is idempotent and safe to resume after failure.
