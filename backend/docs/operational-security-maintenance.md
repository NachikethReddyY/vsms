# Operational security maintenance

Deploy `20260804230000_close_operational_security_gaps` before application code that emits `RECONCILIATION_REQUIRED` or creates artifact cleanup tasks.

## Event artifact cleanup

Hard-delete first validates and records every event-owned consent signature, referral signature, and referral PDF in `artifact_cleanup_tasks` inside the same database transaction that deletes the event. It never deletes a file before commit. After commit, the service claims those durable tasks and unlinks only validated regular files under the configured signature or referral roots.

Failed and stale claims remain retryable with bounded exponential backoff. After the final automatic attempt, the task moves to `ESCALATED`; it is not silently abandoned. Administrators can list tasks without exposing storage paths and must explicitly choose one of the audited maintenance actions:

- `GET /api/v1/admin/maintenance/artifact-cleanup?status=ESCALATED` lists safe task metadata.
- `POST /api/v1/admin/maintenance/artifact-cleanup/:taskId` with `{"action":"REQUEUE","resolutionNote":"..."}` resets an escalated task for another bounded retry cycle.
- The same endpoint with `{"action":"RESOLVE","resolutionNote":"..."}` records an administrative resolution without deleting another file.

Only an `ESCALATED` task accepts either action. The resolution note and administrator identity are written to the audit log. The scheduled referral-maintenance endpoint also processes a batch of pending cleanup tasks. An invalid key, a key whose embedded event ID differs from the deleted event, a symlink, or a document key referenced outside the event fails closed and cannot delete a different event's file.

Filesystem unlink removes the application's copy but cannot guarantee physical-sector erasure on SSD or copy-on-write media. Use encrypted volumes and destroy retired volume keys when cryptographic erasure is required.

## Referral delivery reconciliation

Call `POST /api/v1/admin/maintenance/referral-deliveries` from an authenticated administrator session on a regular schedule. The request may be `{}`; it will:

1. clear expired or malformed handoff-secret escrow;
2. move stale `SENDING` rows to `RECONCILIATION_REQUIRED` without calling the email provider again; and
3. retry eligible artifact cleanup outbox rows.

An ambiguous send must be checked against SES delivery/event logs. Submit a resolution only after the provider outcome is known:

```json
{
  "staleAfterMinutes": 30,
  "resolutions": [
    {
      "deliveryId": "00000000-0000-4000-8000-000000000000",
      "outcome": "SENT",
      "providerMessageId": "provider-confirmed-message-id"
    }
  ]
}
```

Use `FAILED` only when the provider confirms the message was not accepted; omit `providerMessageId` in that case. A provider-confirmed `FAILED` delivery is still not retried automatically. In a later request, an administrator may explicitly move only a `FAILED` delivery whose failure reason is `PROVIDER_CONFIRMED_NOT_SENT` back to `QUEUED`:

```json
{
  "retryDeliveryIds": ["00000000-0000-4000-8000-000000000000"]
}
```

This transition preserves the original referral, document, recipient, immutable issuance fingerprint, and idempotency key. The endpoint does not contact the email provider; the normal delivery worker performs the queued attempt. `SENDING` and `RECONCILIATION_REQUIRED` deliveries are ambiguous and can never use this retry path. Every resolution and retry authorization is compare-and-set and audit logged with the administrator's identity.

## QR issuance invariant

The migration normalizes stale and duplicate active QR rows and then creates a partial unique index allowing at most one row with `is_active = true` for a registration. Issuance locks the registration row and reuses an existing valid pass, so concurrent first requests converge on the same QR instead of minting competing bearer credentials. Explicit reissue revokes all active rows while holding the same lock before creating the replacement.
