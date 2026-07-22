# VSMS Project 2 — Team Work Plan

This plan assigns each person a **vertical, demo-ready feature area**. The owner of a feature is responsible for its UI, API, database changes, validation, tests, and short documentation—not only the frontend screen.

## Team ownership

| Owner | Primary area | Deliverables |
| --- | --- | --- |
| **Nachiketh Reddy** | Event operations, clinical review, design, offline platform, and deployment | Event CRUD and status; event details form; schedules; add stations from templates; assign manpower and shifts; shared UI/design system; doctor/reviewer dashboard; review decision and urgency; referral/clinical PDF; encrypted document delivery by email; shared offline architecture and synchronization; cloud deployment, monitoring, and deployment guide |
| **Mike** | Authentication and participant registration | Staff sign-in/sign-out; participant registration, update, search, and event check-in; consent and digital signature; unique participant ID; authentication logging; password change/reset; session handling; registration history |
| **Sitt** | Station workflows, offline data capture, and system administration | Reusable station-template pool; import/configure templates in an event; station ordering and availability; the four required screening forms; result validation; automatic threshold flags and screener acknowledgement; screening history/completion; offline screening capture and sync integration; manage users, roles, account status, and staff availability |
| **Keefe** | QR, queue, and security | Signed event QR generation/scanning/revocation; QR check-in; virtual queue, transfers, calling status, workload, and estimated wait; RBAC/security controls; audit trail; threat model, dependency scan, and security test evidence |

## Feature boundaries and hand-offs

### Nachiketh Reddy — event and clinical workflow

- Create, edit, view, cancel, and complete events.
- Configure event dates, capacity, station sequence, schedules, staff assignments, and shifts.
- Consume Sitt's station templates instead of duplicating station definitions.
- Build the shared responsive layout, components, colours, accessibility states, and tablet behaviour.
- Give the reviewer a complete participant summary containing results and flags.
- Record the final outcome: complete, monitor, refer, or urgent escalation.
- Generate a versioned PDF referral/clinical summary.
- Email documents securely. Do not put sensitive medical data directly in the email body; use an encrypted attachment or an expiring authenticated link.
- Own the shared offline architecture with Sitt: local outbox, sync service, connectivity state, retries, and idempotency contract.
- Deploy the integrated application and document configuration, secrets, backups, logs, and rollback.

### Mike — identity and registration

- Treat staff users and participants as different entities; participants do not sign in.
- Implement staff authentication, logout, refresh/session timeout, password reset/change, and failed-login logging.
- Register a new participant or find and update an existing participant.
- Create a separate event check-in for returning participants to prevent duplicate profiles.
- Capture consent, digital signature, contact details, and any approved emergency/assistance fields.
- Produce the participant/event identifier consumed by Keefe's QR and queue features.
- Record audit events for authentication, registration, edits, consent, and signature capture.

### Sitt — station templates, screening, and users

- Maintain a reusable pool of station templates with fields, validation, instructions, and active versions.
- Let an event import a template, then configure its order, capacity, and assigned screeners without changing the master template.
- Implement the required screening capture: visual acuity, refraction, colour vision, and eye health.
- Save station results in a common contract that Nachiketh's reviewer dashboard can display.
- Apply versioned, rule-based flags and require screener acknowledgement; the system must not make the final clinical decision.
- Make station forms and screening writes work offline, save them to the shared local outbox, and verify successful synchronization with Nachiketh.
- Support system administration: create/disable staff users, assign roles, and view account state.
- Coordinate role definitions with Keefe so permissions are enforced by the API, not only hidden in the UI.

### Keefe — participant movement and security

- Generate an opaque, signed, event-specific QR token containing no personal or medical data.
- Scan/verify/revoke/reissue QR passes and support a manual lookup fallback.
- Implement queue numbers, wait/in-progress/completed states, next-participant calling, station transfer, priority/urgent handling, and queue workload.
- Enforce RBAC, input validation, rate limiting, secure headers, safe errors, TLS/secrets guidance, and audit logging.
- Produce the threat model, security checklist, scan results, and focused authorization/security tests.

## Shared contracts to agree before coding

The team should freeze these in the first integration meeting:

1. **Roles:** Administrator, Event Manager, Registration Officer, Screener, and Reviewer/Doctor.
2. **Core records:** User, Event, StationTemplate, EventStation, StaffAssignment/Shift, Participant, EventRegistration, Consent/Signature, QueueEntry, ScreeningResult, RuleEvaluation, Review, Referral, NotificationDelivery, SyncAction, and AuditLog.
3. **API rules:** `/api/v1`, JWT/session strategy, backend role checks, one validation/error shape, request IDs, and idempotency keys for writes.
4. **Shared status values:** event, queue, station completion, screening flag, review/referral, email delivery, and synchronization states.
5. **Ownership rule:** the owner who changes a shared contract updates the OpenAPI/schema first and informs all consumers.
6. **Golden demo:** sign in → register and sign consent → issue/scan QR → queue through stations → capture results offline → reconnect and sync → doctor reviews → referral generated/delivered → dashboard updates.

## Features missing from the original split

These are required or strongly recommended and now have explicit owners above:

| Missing feature/work | Owner |
| --- | --- |
| Offline operation, local outbox, retry, conflict/duplicate prevention, and sync health | Nachiketh and Sitt |
| Required screening types and automatic flag acknowledgement | Sitt |
| Participant search/update, returning-participant check-in, logout, password/session flows | Mike |
| Role-based access control and backend authorization | Keefe, with Sitt for role administration |
| Audit logging and login/change history | Keefe platform; each feature owner emits its events |
| Referral PDF/history/status and secure delivery tracking | Nachiketh |
| Event/participant/referral statistics and operational dashboard | Nachiketh, using queue data from Keefe |
| Validation, error states, accessibility, responsive/tablet design | Each owner; Nachiketh defines shared standards |
| API documentation, database migrations, sample/seed data | Each owner for their area |
| Unit, integration, end-to-end, offline, and security testing | Each owner; Nachiketh and Sitt coordinate offline tests, while Keefe coordinates security tests |
| Monitoring, backups, secrets, CI/CD, rollback, and disaster-recovery notes | Nachiketh |
| Report, diagrams, slides, demo script, and academic-integrity evidence | Shared; Nachiketh integrates, each owner supplies their section |

## Scope priority

### P0 — assessed core

- Authentication, RBAC, and user administration
- Event/station/staff configuration
- Participant registration, consent, and search
- Queue movement and all four screening forms
- Automatic flags, reviewer decision, and referral
- Offline capture, safe synchronization, audit logs, and dashboard
- Tests, security evidence, documentation, and deployable demo

### P1 — complete after the end-to-end core works

- QR scanning
- Secure referral email delivery
- Digital signature polish
- Cloud hosting, enhanced analytics, and real-time queue updates

### P2 — defer unless time remains

- SMS, external health integrations, OCR/AI, multi-language support, advanced report exports, and direct screening-device integration

## Integration milestones

| Milestone | Outcome |
| --- | --- |
| **M1 — contracts** | Roles, schema, status enums, API/OpenAPI, wireframes, and test data agreed |
| **M2 — event entry** | Staff can sign in, create an event, import stations, assign shifts, register a participant, and enter the first queue |
| **M3 — screening path** | QR/manual lookup, station data capture, flags, transfers, and reviewer decision work end to end |
| **M4 — resilience** | The golden path works offline, reconnects without duplicates, and produces audit evidence |
| **M5 — delivery** | Referral output, dashboard, security checks, automated tests, deployment, report, and rehearsed demo are complete |

## Definition of done for every feature

- UI and backend behaviour are connected.
- Authorization and server-side validation are enforced.
- Offline behaviour is defined, even if the feature is intentionally online-only.
- Success, empty, loading, validation, permission, and failure states are handled.
- Audit events are emitted where required.
- Tests cover the happy path and at least one failure/permission case.
- API/schema and short user/developer documentation are updated.
- The feature can be demonstrated with seeded data.
