# VSMS Project 2 — Suggested Team Work Split

Organise the team around **vertical, demo-ready slices**, rather than separating all frontend work from all backend work. Each owner is responsible for building, testing, and documenting their feature area, while following the shared API and data contracts.

## Four-person team

| Owner | Primary responsibility | Must deliver |
| --- | --- | --- |
| 1. Platform and security | Authentication, RBAC, user management, API foundation, audit logs, input validation, rate limits, and secure headers | Login, protected APIs, role enforcement, security evidence and tests |
| 2. Registration and event operations | Events, stations, staff assignment, participant registration/search, participant IDs, and queue transfers | Admin and registration flow through to the queue |
| 3. Screening and referral | Visual-acuity, refraction, colour-vision, and eye-health capture; threshold flags; acknowledgements; reviewer and referral flow | Queue to screening to review and referral |
| 4. Offline, dashboard, and delivery | PWA setup, IndexedDB/local queue, synchronization with retry/idempotency, dashboard/reports, deployment, and demo reset state | Offline capture to sync to dashboard; deployment guide |

Everyone should contribute to the report, testing, diagrams, and presentation. Assign one person—preferably Owner 1 or 4—to act as the integration and report editor.

## Shared decisions for the first meeting

Agree these before feature work begins:

- **Core data model:** User, Event, Station, Participant, QueueRecord, ScreeningResult, Referral, and AuditLog.
- **API conventions:** `/api/v1`, JWT authentication, role checks on the backend, a single validation/error response format, and an idempotency key for write requests.
- **Offline queue lifecycle:** `PENDING → PROCESSING → SUCCESS`, with `FAILED → RETRY` where needed.
- **Architecture:** database choice, offline storage approach, authentication/MFA approach, and deployment target. Record the trade-offs for the report.
- **Golden demo path:** login → register participant → disconnect network → enter screening results → reconnect and sync → reviewer creates referral → dashboard confirms the result.

## Recommended build order

1. Finalise architecture, schema, roles, API contract, and shared UI shell.
2. Build login/RBAC and registration/participant records.
3. Build screening capture, clinical flags, review, and referral.
4. Build offline queue/synchronization and then dashboard/reporting.
5. Add security tests, sample data, diagrams, report content, and rehearse the 15-minute demonstration.

## If there are five team members

Keep Owners 1–3 unchanged and split Owner 4 into:

| Owner | Responsibility |
| --- | --- |
| 4. Offline and deployment | PWA, IndexedDB, sync/retry/idempotency, CI/deployment material |
| 5. Dashboard and evidence | Dashboard/reporting, sample-data generator, testing evidence, diagrams, report integration, and demo coordination |

## Scope priority

Complete the assessed core before bonus work: offline-first operation, RBAC/security, audit trail, screening/review/referral, synchronization, and the operational dashboard.

Good lower-risk bonus choices after that are mobile responsiveness, QR scanning, a real-time dashboard, and AWS hosting.
