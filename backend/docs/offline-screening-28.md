# Offline screening (#28)

Staff tablets must keep working when the venue Wi‑Fi drops. VSMS treats offline as a **temporary, authenticated screener cache** — not a second clinical database.

## Staff flow

1. While online: open the live event or a station page → offline pack **downloads automatically** (nav shows “Preparing offline” → “Offline ready”).
2. Disconnect: station forms still load from the encrypted local snapshot.
3. Save VA / Refraction / Colour Vision → queued locally (`Saved offline…`).
4. Reconnect: auto-sync (or tap sync) → `POST /api/v1/events/{eventId}/sync/screening`.
5. Conflicts stay local until staff fixes the cause (ack required, event ended, etc.).

While the screener stays on the event, the tablet quietly refreshes the offline snapshot about every five minutes so queues stay current before a Wi‑Fi drop.

## Database (server)

| Table / model | Purpose |
| --- | --- |
| `screening_result` | Canonical clinical row (online or after sync). |
| `screening_request_ledger` | Immutable save receipt keyed by `idempotencyKey` + request fingerprint — safe retries. |
| `sync_actions` | Durable sync job per `userId` + `clientActionId`. Stores **metadata only** (station type), never NRIC / pass tokens / full result JSON. |
| `sync_action_transitions` | Ordered status history (`PENDING` → `PROCESSING` → `APPLIED` / `CONFLICT` / `FAILED`) with CAS `version` + processing lease. |

Clinical bodies travel only in the authenticated sync request body, then land in `screening_result` through the same save services used online.

## Secure coding controls

| Control | How |
| --- | --- |
| AuthN | Sync route behind Cognito session (`authenticate`). |
| AuthZ | Same `assertCanScreen` gate as online saves (screener role, live event, active shift). |
| Idempotency | Dual keys: sync `clientActionId` + screening `idempotencyKey` / fingerprints. |
| Conflict hygiene | Unknown server errors map to generic `FAILED`; only an allow-listed `SAFE_CONFLICT_CODES` set is echoed to the tablet. |
| At-rest on device | IndexedDB payload encrypted with AES-GCM; key non-extractable; records bound to `ownerId`. |
| Least data offline | Pass tokens stripped from downloaded queues; expired packs purged (`offlineAccessExpiresAt`). |
| Session hygiene | Logout / user switch clears offline stores. |
| No service-worker PWA yet | App shell must already be loaded; hard refresh while offline loses the SPA until online again. |

## Out of scope for this slice

- Participant self-service offline
- Full Sync Centre conflict-resolution UI
- Eye-health station offline path
- Service worker / installable PWA
