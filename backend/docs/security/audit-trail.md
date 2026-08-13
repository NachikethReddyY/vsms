# Central audit trail

VSMS implements OWASP A09 audit logging as append-only security evidence. The administrator page at `/admin/audit-logs` reads one reverse-chronological feed from three ledgers:

- `AuditLog` for application and operational actions.
- `AuthAuditLog` for authentication and session outcomes.
- `EventAuditLog` for retained event lifecycle snapshots.

The feed is read-only. PostgreSQL triggers reject `UPDATE` and `DELETE` on all three ledgers. A filter-bound, signed keyset cursor prevents clients from modifying pagination state or reusing a cursor with different filters.

## Access and privacy

The backend route requires an authenticated Administrator and the `audit:read` permission. This is enforced server-side; hiding the navigation entry is only a usability measure. Audit metadata is recursively sanitized before insertion. Credentials, tokens, MFA values, signatures, NRIC/national identifiers, contact details, addresses, names, and participant display names are redacted. Operational evidence should use opaque IDs and safe state summaries rather than clinical bodies or participant profiles.

IP address, device, request ID, actor, event ID, before/after state, and failure category are shown only to authorized administrators. Participant-facing and ordinary staff APIs do not expose the centralized feed.

## Covered activity

| Area | Representative immutable events |
| --- | --- |
| Authentication | `LOGIN_SUCCESS`, `LOGIN_FAILED`, `TOKEN_REFRESH_SUCCESS`, `TOKEN_REFRESH_FAILED`, `LOGOUT_SUCCESS`, `GLOBAL_LOGOUT_SUCCESS`, `GLOBAL_LOGOUT_FAILED`, `PASSWORD_CHANGE_SUCCESS`, `PASSWORD_CHANGE_FAILED` |
| Registration and participant maintenance | `EVENT_REGISTRATION_CREATED`, status changes, duplicate denial, participant and consent actions |
| Screening | `SCREENING_RESULT_RECORDED`, `SCREENING_RESULT_CORRECTED`, `SCREENING_FLAG_ACKNOWLEDGED` |
| Queue | queue join, call, start, completion, transfer, priority and manual check-in outcomes |
| QR | generation, verification success, concealed verification denial/failure, revoke and reissue |
| Review and referral | clinical review, referral issuance/revision, handoff, email and delivery outcomes |
| Offline synchronization | batch summary plus per-action `APPLIED`, `CONFLICT`, and `FAILED` outcomes |
| Administration and events | account decisions, staff assignment, event create/update/transition/delete, export and cleanup actions |

Failed or denied security-relevant actions use an allowlisted error category and never persist raw exception messages. Critical domain writes add audit evidence inside the same database transaction where practical. Authentication failures use best-effort logging so an audit-store outage does not leak credentials or replace the original authentication response; audit write failures are themselves emitted to the structured server log.

## API and demonstration

`GET /api/v1/admin/audit-logs` accepts `cursor`, `limit`, `entityName`, `action`, `eventType`, `outcome`, `from`, and `to`. It returns `{ items, nextCursor }`, where each item has a normalized `source` of `APPLICATION`, `AUTHENTICATION`, or `EVENT`.

The normal seed is idempotent and guarantees at least 5,000 generic audit records, satisfying the assignment sample-volume target. Seeded entries are synthetic and PII-free. For a demonstration:

1. Sign in as an Administrator.
2. Open **Audit** in the primary navigation (or **Audit history** in the mobile account menu).
3. Filter by `LOGIN_FAILED`, `SCREENING_RESULT_RECORDED`, or a non-success outcome.
4. Expand **Evidence details** to show request correlation and redacted state.
5. Use **Load older records** to demonstrate the signed global cursor.
6. Attempting to update or delete an audit row in the database is rejected by the immutability trigger.

## Verification evidence

- Unit tests cover merged ordering, filter behavior, signed/tampered cursors, screening creation/correction/acknowledgement, sync outcome types, logout/refresh outcomes, QR denial evidence, and metadata redaction.
- Security tests verify `audit:read` authorization and database immutability.
- Frontend behavior tests cover connection to the normalized API plus loading, empty, filter, pagination, evidence, permission, failure, and retry states.
- The OpenAPI `AdminAuditLogsResponse` documents the same normalized contract used by the page.

Retention duration and archival remain deployment-policy decisions. Until an approved policy exists, VSMS does not provide a routine audit-deletion endpoint.
