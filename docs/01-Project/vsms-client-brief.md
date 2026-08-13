# VSMS — condensed project brief

> Source review: formal project specification, deliverables brief, backend practical guide, supplied code/HTML, and all supplied images in `docs/images/vsms documents/`.  
> **Rule:** “required” below comes from the formal briefs. Diagrams and screenshots are useful reference material, but do not expand scope unless the team deliberately adopts them.

## 1. Project in one paragraph

Build a **secure, offline-capable Visual Screening Management System (VSMS)** for community/senior vision-screening events. It replaces paper forms, manual queues, spreadsheet consolidation, and delayed reporting. Staff register a participant, guide them through multiple screening stations, record and automatically flag results, review cases, issue referrals, and monitor the event. The app must continue to work without internet: it saves work locally, then safely synchronizes it later without duplicates.

## 2. Problem and success targets

Current events have lost/damaged paper forms, duplicate/manual entry, poor queue visibility, unreliable connectivity, weak access control/audit trails, and slow manual reporting.

| Goal | Target |
| --- | --- |
| Registration time | 50% reduction |
| Paperwork | 90% reduction |
| Screening throughput | 30% increase |
| Offline coverage | 100% of core operations |
| Reporting | same-day |
| Event scale | 500 participants/event |
| API performance | ≤1 second |
| Availability target | 99.9% |

## 3. Required product scope

### Roles

- **Administrator:** manage users, roles, events, stations, and staff assignment.
- **Event manager:** operate events, schedules, stations, and dashboard.
- **Registration officer:** register/update participants and manage queue hand-off.
- **Screener:** record station results and acknowledge automatic flags.
- **Reviewer:** review outcomes and flags; approve/create referrals.

### Core workflow

`Registration → visual acuity → refraction → colour vision → eye-health assessment → review & referral`

The supplied senior-screening concept also shows near vision, contrast sensitivity, cataract/glaucoma risk, fall risk, and walking-aid assessment. Treat these as **candidate additional fields/stations**, not mandatory, unless your lecturer/client confirms them.

### Functional requirements

- CRUD events; configure stations, schedules, and staff.
- Admin user management: create/disable users and assign roles.
- Participant registration, update, search, and unique participant ID. QR code is optional in the common specification.
- Queue status, participant transfer, station workload, and completion tracking.
- Capture visual-acuity, refraction, colour-vision, and eye-health results.
- Apply threshold/rule-based flags automatically and require screener acknowledgement.
- Reviewer checks results/flags and creates referrals.
- Dashboard: active event, queues, completion, synchronization health, outcomes/referrals.
- Reports: screening/event/referral statistics; the visual reference also proposes PDF report, referral letter/list, and QR verification.

## 4. Offline and sync: non-negotiable behaviour

- Core screens, navigation, and data entry work with no network.
- Save writes locally (IndexedDB is the suggested browser store) and show a clear pending/synced/failed state.
- Let a user choose continuous sync or end-of-event sync.
- When online, send pending actions and retry failures automatically.
- Every write carries an idempotency key/transaction ID so retrying cannot create a duplicate.

Minimum state machine: `PENDING → PROCESSING → SUCCESS`; failure follows `FAILED → RETRY → PENDING` until a retry limit, then needs attention. Reference diagrams propose exponential backoff, max 5 attempts, 10-second initial delay, 10-minute maximum delay, and jitter; these are sensible defaults, not a stated marking requirement.

## 5. Security requirements

The deliverables brief maps the build to OWASP Top 10:

| Area | Required control |
| --- | --- |
| A01 | RBAC, enforced in the backend |
| A02 | TLS 1.3 and AES-256 / encryption at rest |
| A03 | server-side input validation |
| A04 | threat model |
| A05 | secure configuration and headers |
| A06 | dependency scanning |
| A07 | MFA |
| A08 | idempotent APIs |
| A09 | audit logging |
| A10 | URL allow lists |

Also include rate limiting, session timeout, password policy, encryption in transit/at rest, safe error responses, and no secrets in source control. Audit registration, result edits, flag acknowledgement, review/referral, authentication, and sync outcomes.

## 6. Required API surface

```text
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh

POST|GET /api/v1/events
PUT|DELETE /api/v1/events/{id}

POST|GET /api/v1/participants
PUT /api/v1/participants/{id}

POST /api/v1/screenings/visual-acuity
POST /api/v1/screenings/refraction
POST /api/v1/screenings/colour-vision
POST /api/v1/screenings/eye-health
POST /api/v1/sync/batch
```

Use a versioned API, authenticated requests, role checks, validation, consistent error responses, audit records, and idempotency on writes.

## 7. Data model: minimum useful shape

Use the simplest model that serves the workflow:

- `users`, `events`, `stations`, `staff_assignments`
- `participants`, `queue_entries`
- `screening_results` — one result per participant, event, and station; station-specific detail can be JSONB
- `rule_versions` / `rule_evaluations` — rule version, triggered flags, and explanation
- `reviews`, `referrals`, `audit_logs`
- client-side `outbox` / sync-status records

The supplied PostgreSQL guide supports a relational model with JSONB for different station measurements. The DynamoDB guide supports a query-first single-table model using `PK`/`SK` and GSIs. **Choose one persistence approach and document why; do not build both.**

## 8. Clinical/rule guidance from the sample forms

These examples are inputs for configurable screening rules, not medical advice or a diagnosis engine.

- Visual acuity: flag worse-than-threshold distance/near results, two-line inter-eye asymmetry, or poor pinhole improvement; sample normal distance is 20/20–20/25 and near J1–J2.
- Refraction: capture habitual and manifest prescription (sphere, cylinder, axis, prism/base, add, distance VA); flag large prescription changes, high astigmatism, or new prism.
- Colour vision: record plate responses per eye; flag failed responses, marked eye asymmetry, and unusual demographic patterns for clinical review.
- Flag levels in visual references: `NORMAL`, `REVIEW`, `REFER`, `URGENT`; human reviewer makes the final decision.

Keep rules versioned and evaluated server-side after sync. A client may cache the active version for offline preliminary flags.

## 9. What the supplied visual/reference material adds

The 30 supplied images and supporting HTML/code reinforce these ideas:

- tablet/PWA-friendly screener UI with obvious online/offline state and sync queue;
- clear station-by-station workflow, result summary, dashboard cards, referral/report output;
- API contract/OpenAPI, validation, JWT/RBAC, request IDs, audit log, and idempotency;
- local IndexedDB outbox and retry state diagram;
- AWS alternatives: Cognito, API Gateway, Lambda/Express, DynamoDB or PostgreSQL/RDS, S3, CloudWatch, WAF, SQS/EventBridge;
- data lifecycle/retention, monitoring, and least-privilege secrets/networking examples;
- optional AI explanation layer: deterministic rules set a flag; any LLM only explains it from approved guidance and never makes the clinical decision.

Most of the architecture illustrations propose microservices, queues, AI, multi-AZ databases, dashboards, event buses, and several AWS products. **They are reference patterns, not MVP scope.**

## 10. Deliverables and assessment facts

- Due **16 August 2026, 23:59** via PoliteMall; submit project, report, slides, and academic-integrity form.
- Report: 10–12 pages. Include executive summary, requirements, use cases, architecture, database/API/security design, testing, deployment guide, and reflection.
- Required diagrams: context, use case, NoSQL design, component, deployment, sequence, security architecture, offline synchronization, and secure API design.
- 15-minute demo: login, registration, screening, offline mode, synchronization, dashboard, and security controls.
- Sample data target: 10 events, 20 users, 500 participants, 2,500 screening results, 500 queue records, 5,000 audit logs.
- Marks: requirements 5%, architecture 10%, database 5%, API 10%, security 20%, implementation 20%, testing 10%, bonus 10%, presentation/Q&A 10%.
- Bonus options include QR scanning, responsive mobile UI, event-driven architecture, real-time dashboard, analytics, multi-event ops, AWS hosting, Secrets Manager, and Cognito.

## 11. Recommended MVP boundary

Build one responsive React app, one Node/Express API, one database, IndexedDB outbox, JWT/RBAC, audit log, the four required screening forms, rule flags, review/referral, and a small operational dashboard. That covers the assessed core.

Defer QR, AI/RAG, microservices, SQS/EventBridge, real-time updates, SMS/email, AWS deployment, and advanced analytics until the core demo works end-to-end offline.

