# VSMS 15-minute demo outline

This is a run sheet, not a rehearsal record. It describes the shortest
evidence-backed path through the current browser and API. Do not describe a
step as completed until it has been observed in the authorized environment.
Use [`presentation-q-and-a.md`](presentation-q-and-a.md) for the questions that
usually follow this demonstration.

| Time | Segment | Show | Evidence / precondition |
| --- | --- | --- | --- |
| 0:00–1:00 | Scope | State the event workflow and the boundary: React/Vite browser client → Express API → Prisma/PostgreSQL; Cognito is the identity boundary when configured | `README.md`, `docs/04-Security/secure_coding/report.md` |
| 1:00–3:00 | Sign in | Use the hosted Cognito authorization flow, return to the dashboard, and show the authenticated account/event scope | `backend/routes/authRoutes.js`, `backend/utils/cognitoClient.js`; requires configured provider and test account |
| 3:00–5:00 | Event and participant | Open an event, show station/staff context, search or register a participant, and show the event registration/queue path | Event and participant OpenAPI operations; requires seeded/authorized data |
| 5:00–7:30 | Online screening | Open assigned stations, record representative visual-acuity, refraction, colour-vision and eye-health results, show server-side validation and an acknowledged rule flag, then show queue/review state | `screeningService.js`, station pages; requires an in-progress event and active screener duties |
| 7:30–10:00 | Offline capture | While online, prepare the scoped offline pack; disconnect the network, hard-refresh the cached PWA, save a supported station result, and show pending/offline status | `OfflineSyncControl.tsx`, `offlineSync.ts`, Vite PWA config; offline pack must be prepared first |
| 10:00–11:30 | Reconnect and sync | Restore connectivity, show the sync request/result, and show applied or conflict status | `POST /api/v1/events/{eventId}/sync/screening`, `syncService.js`; use safe test data only |
| 11:30–13:00 | Review and referral | Open the clinical review, record the reviewer decision, issue or revise a referral, and show the protected document path if available | `reviewService.js`, `referralService.js`; requires reviewer access and configured document storage path |
| 13:00–14:15 | Dashboard/report | Show event metrics and aggregate report/export status; summarize the 500-participant performance and verified backup restore | `analyticsService.js`, `reportingService.js`, `docs/2026-08-13-performance-recovery.md` |
| 14:15–15:00 | Security recap | Point to event-scoped authorization, validation, CSRF/session controls, idempotency, audit records, encrypted local storage and the OWASP verification matrix; distinguish current lab deployment evidence from the optional HA foundation | `docs/04-Security/secure_coding/diagrams/SecureApiDesign.md`, `backend/docs/operations/offline-screening-28.md`, `docs/04-Security/owasp-verification-matrix.md` |

## Reset and safety checklist

- Use synthetic or approved demonstration data only; do not place real
  identifiers, tokens, cookies, certificates or logs in screenshots or the
  submission archive.
- Confirm an assigned screener duty, an `IN_PROGRESS` event, supported station
  type and a current offline-access expiry before the offline segment.
- Prepare the clinical data pack while online; the service worker caches the
  app shell while IndexedDB separately stores the encrypted scoped pack.
- Capture only observed results. Use the measured performance numbers in the
  dated report; do not invent live availability or provider delivery.
