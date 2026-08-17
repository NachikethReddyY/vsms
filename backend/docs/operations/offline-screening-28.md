# Offline-first event operations

VSMS supports complete **device-local event-day operation** after an authorized staff member prepares an event while connected. Disconnected devices do not coordinate with each other; the server remains the canonical shared record after synchronization.

The service worker precaches only the application shell. API responses are never used as the offline database. Role-scoped event data and pending commands are encrypted with AES-GCM in IndexedDB and bound to the authenticated user, event, device, and a short server-signed capability lease.

## Supported scope

| Workflow | Device-local behavior |
| --- | --- |
| Events and staffing | Downloaded assigned events, schedules, own duties, stations, and manager-scoped event views remain navigable. Staffing changes remain online-only. |
| Registration | Walk-ins are always saved locally first, even while connected. The device shows a queue number and station number; it never invents a QR. Participant, NRIC, contact, emergency-contact, evidence, route seed, and check-in data remain encrypted until a durable receipt. |
| Canonical QR | After registration sync, the device fetches the server-issued pass before atomically deleting the temporary registration command. A failed QR fetch leaves the command pending for exact replay. Cached canonical passes remain viewable offline. |
| Queue and route | View, priority, call, start, skip, and versioned route overrides operate on the downloaded queue. Server receipts return canonical state; stale transitions remain visible as conflicts. |
| Screening | Visual acuity, refraction, colour vision, eye health, and custom schema stations validate and save locally using the downloaded schema and rules. |
| Clinical review | The review queue, result detail, decision, referral draft, and signature are encrypted locally. The signature artifact uploads first on reconnect; the decision then reuses the canonical review service. |
| Operations and reports | Pages render clearly labelled `This device` projections. Cloud analytics, final export jobs, PDF generation, and downloads require a connection and are never shown as complete while offline. |

Global account administration, Cognito changes, destructive event deletion, audit search, referral email/PDF delivery, and cross-device live totals remain online-only. These operations require current server authorization or an external provider and are not queued.

## Staff flow

1. While connected, open an assigned event. VSMS downloads the role- and duty-scoped pack and shows `Offline ready` only after signature verification and one encrypted IndexedDB transaction complete.
2. Disconnect, reload, or reopen a protected event route. The valid stored session and signed lease unlock only that user's downloaded scope.
3. Work normally. Each mutation updates the encrypted read model and appends its typed command atomically. The UI reports `Saved on this device` until the server confirms it.
4. Choose automatic sync or manual end-of-event sync. Automatic mode runs on save, reconnect, foreground activity, and the bounded retry timer. Manual mode sends only when the user selects `Sync now`.
5. Reconnect. Registration commands synchronize before queue/route, screening, and review commands. Commands are deleted only after a durable `APPLIED` receipt and any required canonical artifact has been stored.
6. Conflicts remain encrypted on the originating device. Authorization loss locks the pack; it never attributes work to a different staff member or silently deletes clinical evidence.

An access-lease expiry stops new viewing and capture. It does not erase pending work. Unconfirmed ciphertext remains locked for the seven-day recovery window unless an authorized user completes sync or explicitly clears device data.

## Synchronization endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/events/{eventId}/offline-pack` | Signed, device-bound, role/duty-scoped event read model. |
| `POST /api/v1/events/{eventId}/sync/operations` | Typed registration, queue, route, and review commands in batches of at most 25. |
| `POST /api/v1/events/{eventId}/sync/screening` | Existing station-result commands plus a fresh scoped screening pull. |

Every command has a client-generated action ID and canonical request fingerprint. Replaying the same action returns the stored safe receipt; reusing its ID for different input is rejected. Each action is committed independently so losing the connection mid-batch leaves either a durable receipt or an encrypted pending command.

## Server records

| Table or model | Purpose |
| --- | --- |
| Domain tables | Canonical participant, registration, route, queue, result, review, and referral records created through the same services as connected requests. |
| `screening_request_ledger` | Immutable screening receipt keyed by idempotency key and request fingerprint. |
| `sync_actions` | Durable per-user action status and safe response receipt. It stores identifiers and hashes, never NRIC, QR bearer values, signatures, or clinical payload bodies. |
| `sync_action_transitions` | Ordered `PENDING`, `PROCESSING`, `APPLIED`, `CONFLICT`, and `FAILED` history with compare-and-swap versioning and a processing lease. |

Every synchronized command rechecks current event membership, role, active duty, event state, expected queue/route version, and domain invariants. A locally valid lease never bypasses server authorization on reconnect.

## Security controls

| Control | Implementation |
| --- | --- |
| Offline authorization | ES256 capability lease binds actor, event, device, pack, roles, capabilities, issue time, and absolute expiry. The browser verifies it with a pinned public-key fingerprint before storing the pack. |
| Data minimization | Packs omit QR bearer tokens, raw NRIC outside registration capture, unrelated participants, other staff notes, referral PDFs, and unneeded clinical data. |
| Device storage | Non-exportable WebCrypto key, AES-GCM ciphertext, and owner/event/kind additional authenticated data. Cache Storage contains only the application shell. |
| Session lifecycle | Transport failure does not sign out a still-valid offline user. Logout and account switching lock ciphertext; only an explicit confirmed device purge removes unconfirmed work. |
| Idempotency | Database ledgers, domain request receipts, state predicates, and route versions prevent duplicate or stale application. Redis request middleware is not trusted for offline durability. |
| External effects | Email, canonical PDFs, report jobs, Cognito mutations, and remote revocation remain server-authoritative and visibly pending or unavailable offline. |

### Signed capability lease deployment

Production requires `OFFLINE_LEASE_PRIVATE_KEY_PEM` on the API and the matching `VITE_OFFLINE_LEASE_KEY_ID` at frontend build time. Generate a P-256 PKCS#8 key, store it in the server secret manager, and never expose it to the browser:

```bash
openssl ecparam -name prime256v1 -genkey -noout \
  | openssl pkcs8 -topk8 -nocrypt -out offline-lease-private.pem
```

Derive the public-key ID without printing the private key:

```bash
OFFLINE_LEASE_PRIVATE_KEY_PEM="$(<offline-lease-private.pem)" node -e '
const c=require("node:crypto");
const k=c.createPublicKey(c.createPrivateKey(process.env.OFFLINE_LEASE_PRIVATE_KEY_PEM)).export({format:"jwk"});
const j={kty:"EC",crv:"P-256",x:k.x,y:k.y};
console.log(c.createHash("sha256").update(JSON.stringify(j)).digest("base64url"));'
```

Set that output as `VITE_OFFLINE_LEASE_KEY_ID`. The API refuses production startup without its private key. A production browser refuses a pack when the pin is absent, the JWK fingerprint differs, any bound field is changed, the signature is invalid, or the lease has expired.

Key rotation is a coordinated API/frontend release: generate the replacement, build the frontend with its new key ID, deploy both together, then remove the old secret. Previously verified encrypted packs remain usable only until their existing lease expires. Development and tests use a process-local ephemeral key.

## Device checkout and recovery

- Prepare only assigned events and confirm `Offline ready`, lease expiry, pending count, and storage availability before venue deployment.
- Use one staff account per device session. Do not share an unlocked tablet between staff.
- At handover, sync until pending is zero. If a conflict or locked-recovery count remains, keep the device encrypted and escalate it; do not clear browser data.
- Use `Clear offline data` only after confirmed sync or an explicit supervised decision. The warning states how many pending records would be destroyed.
- If a device is lost, revoke the staff session and event assignment when connectivity returns. The short lease bounds offline exposure; remote revocation cannot reach a physically disconnected browser.
