# Offline screening (#28)

Staff tablets must keep working when venue Wi-Fi drops. VSMS treats offline storage as a temporary, authenticated screener cache, not as a second clinical database.

The dashboard is an installable PWA. After an online visit, its service worker caches the application shell so staff can reopen it without downloading the interface again. Screening payloads and queue snapshots remain in encrypted IndexedDB until synchronization.

## Supported scope

Offline capture currently covers every station type accepted by the screening synchronization API:

- Visual acuity
- Refraction
- Colour vision
- Custom schema-driven screening stations

Eye-health findings are completed in the clinician-led review workflow and are deliberately rejected by the screener synchronization API. Registration, event administration, clinical review, referrals and report generation still require a server connection. Therefore, the current implementation can claim **100% coverage of supported screener capture**, but not 100% offline coverage of the whole application.

The Operations Center calculates its offline-coverage percentage over active event stations. An event reaches 100% only when all active stations use one of the supported types above.

## Staff flow

1. While online, open a live event or station page. The offline pack downloads automatically and the navigation changes from `Preparing offline` to `Offline ready`.
2. Disconnect. Supported station forms load from the encrypted local snapshot.
3. Save a supported result. The mutation is encrypted and queued locally as `Saved offline`.
4. Reconnect. Automatic synchronization, or a manual sync action, posts to `POST /api/v1/events/{eventId}/sync/screening`.
5. Conflicts remain on the device until staff resolve the cause, such as a required acknowledgement or a closed event.

While a screener remains in the event, the tablet refreshes its snapshot approximately every five minutes so queues are current before a connection loss.

## Server records

| Table or model | Purpose |
| --- | --- |
| `screening_results` | Canonical clinical result created online or after synchronization. |
| `screening_request_ledger` | Immutable save receipt keyed by idempotency key and request fingerprint for safe retries. |
| `sync_actions` | Durable action per user and client action ID. It stores status metadata, not NRIC, pass tokens or full result payloads. |
| `sync_action_transitions` | Ordered status history using `PENDING`, `PROCESSING`, `APPLIED`, `CONFLICT` and `FAILED`, with compare-and-swap versioning and a processing lease. |

Clinical payloads travel in the authenticated request body and enter `screening_results` through the same validation and save services as online writes.

## Security controls

| Control | Implementation |
| --- | --- |
| Authentication | Cognito-backed staff session is required by the sync route. |
| Authorization | The same event, role, station and active-shift checks apply to online and synchronized saves. |
| Idempotency | Client action IDs and screening idempotency keys prevent duplicate writes. |
| Conflict hygiene | Only allow-listed safe error codes return to the tablet; unexpected server errors remain generic. |
| Device storage | IndexedDB payloads use AES-GCM and are bound to the authenticated owner. |
| Data minimization | Downloaded queues omit pass tokens; expired packs are purged. |
| Session hygiene | Logout or a user change clears offline stores. |
| Offline shell | The service worker caches the PWA shell; clinical data remains in encrypted IndexedDB. |

## Remaining work for whole-application offline operation

- Offline participant registration and check-in
- Offline clinical review and referral decisions
- Offline event administration and report access
- A full conflict-resolution interface for actions requiring staff intervention
