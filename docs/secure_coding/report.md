---
title: VSMS secure coding project report
authors:
  - "[Human input required: verify team names and student identifiers]"
module: ST2515 Secure Coding
date: "[Human input required]"
submission: "[Human input required]"
---

# Visual Screening Management System

> This is the repository-side report source. It records what can be verified
> from the current branch and labels deployment, manual-document, and
> demonstration evidence that still requires a human owner. It does not claim
> a live cloud result, a rehearsal, a signature, a deadline, or a measured
> performance result.

## 1. Executive summary

VSMS is a React/Vite dashboard backed by a Node.js Express REST API and a
Prisma-managed PostgreSQL database. It supports event operations, participant
registration, station queues, QR hand-off, three online screening save paths,
review/referral workflows, aggregate reporting, and a scoped offline
screening pack.

The submission architecture is a single Express application intended to run
on an EC2 host, with PostgreSQL reached through `DATABASE_URL`. Cognito is the
configured external identity provider when its environment values are
present. The repository does not contain an EC2 instance identifier, security
group, DNS record, live health result, or deployment screenshot, so the EC2
statement is a deployment target rather than live-deployment evidence.

The browser client is offline-capable for assigned screening stations, but it
is not currently an installable service-worker PWA. The offline implementation
uses encrypted IndexedDB records and the authenticated
`/events/{eventId}/sync/screening` endpoint; a hard refresh while offline
requires the app shell to have already been loaded.

## 2. Scope and evidence rules

The canonical implementation sources are:

| Area | Evidence | What it supports |
| --- | --- | --- |
| Browser | `react-user-dashboard/src/features/screening/offlineSync.ts`, `OfflineSyncProvider.tsx`, station pages, Vite config | React/Vite dashboard, scoped encrypted IndexedDB offline pack, sync and conflict handling |
| API | `backend/app.js`, `backend/server.js`, `backend/routes/`, `backend/controllers/`, `backend/services/` | Express request path, middleware, service and worker boundaries |
| Contract | `backend/docs/openapi.yaml`, `backend/scripts/check-contract.js` | Versioned API paths, operation IDs, response/security contract |
| Database | `backend/prisma/schema.prisma`, `backend/prisma/migrations/` | PostgreSQL provider, relational models, constraints, indexes and migration-owned objects |
| SQL evidence | `backend/stored_procedures.sql` | A separate stored-procedure/function draft; not proof that those objects are installed or called by the current Prisma path |
| Auth/config | `backend/config/env.js`, `backend/utils/cognitoClient.js`, `infrastructure/cognito.yaml` | Cognito integration/configuration boundary and fail-closed environment validation |
| Logging | `backend/utils/logger/logger.js`, `backend/middlewares/httpLogger.js`, `backend/app.js`, and `backend/tests/unit/http-logging.test.js` | Pino redaction and correlated HTTP completion logging |
| Tests | `backend/tests/`, `react-user-dashboard/src/**/*.test.*`, package scripts | Runnable local checks; not cloud or rehearsal evidence |

`docs/vsms-client-brief.md` describes project requirements and alternatives.
Reference material is not treated as proof that an alternative architecture
was implemented.

The combined repository uses Pino for structured logging, `pino-http` for
correlated HTTP completion records, and the request boundary
versioned route and middleware → controller → service → Prisma Client →
PostgreSQL. Controllers map HTTP input/output; services own domain decisions,
authorization-sensitive checks, Prisma access and transactions. There is no
repository layer; `backend/docs/request-architecture.md` records the same
boundary.

## 3. Implemented architecture

```text
Browser React/Vite dashboard
  ├─ authenticated API client and role-aware routes
  ├─ station forms and queue/review/report screens
  └─ encrypted IndexedDB screening pack and sync outbox
        │ HTTPS / same-origin proxy or configured API origin
        ▼
Node.js + Express API
  ├─ auth, CSRF, rate limits, request context and validation middleware
  ├─ route → controller → service modules
  ├─ separate Node worker processes launched from `backend/scripts/`
  └─ Prisma client
        │ DATABASE_URL
        ▼
PostgreSQL
  ├─ relational constraints, indexes and transactions
  ├─ append-only audit and sync transition records
  └─ event, registration, queue, screening, review and referral data

External identity boundary: Cognito authorization-code + PKCE flow when
configured; the API still owns local account state and event authorization.
```

### Runtime and deployment boundary

- **Express:** `backend/app.js` mounts the API and middleware; `backend/server.js`
  owns startup, TLS-aware local transport and graceful shutdown. Worker
  scripts under `backend/scripts/` are separate Node processes operated
  alongside the Express process; they are not in-process Express workers.
- **EC2 target:** use the backend start/deploy scripts on a controlled EC2
  host. Production still needs an operator-managed HTTPS reverse proxy,
  firewall/security-group policy, process supervision, backups and monitoring.
  None of those live controls are evidenced by this repository.
- **PostgreSQL:** Prisma declares `provider = "postgresql"`; migrations are
  the runtime schema authority. `backend/db/init.sql` intentionally refuses
  to create the old incompatible schema.
- **Logging:** `backend/utils/logger/logger.js` uses Pino
  with redaction, and `backend/middlewares/httpLogger.js` uses `pino-http` for
  correlated HTTP completion records. `backend/app.js` mounts it after
  request context, and `backend/tests/unit/http-logging.test.js` checks
  redaction, correlation and completion fields.
- **Identity:** Cognito integration is present in code and infrastructure
  configuration, but a live user pool or provider result is not claimed.

### Implemented, planned and deferred services

| Status | Service/capability | Evidence and boundary |
| --- | --- | --- |
| Implemented | Express REST API | `backend/app.js`, `backend/routes/`, OpenAPI contract |
| Implemented | PostgreSQL/Prisma persistence | `backend/prisma/schema.prisma`, migrations, services |
| Implemented | Event, membership, station and queue operations | `backend/services/event/`, `backend/services/screening/`, queue routes |
| Implemented | Participant, consent, QR and registration flows | `backend/services/participant/`, participant/registration/QR routes |
| Implemented | Visual acuity, refraction and colour-vision save paths | `screeningService.js`, corresponding OpenAPI operations and frontend station pages |
| Implemented | Review, referral and aggregate report/export source paths | `reviewService.js`, `referralService.js`, `services/reporting/` |
| Implemented | Transactional outbox and separate Node worker processes | `domainEventBus.js`, `scripts/domain-event-worker.js`, `scripts/report-worker.js`, and `scripts/lifecycle-email-worker.js`; each is a standalone entry point over shared PostgreSQL state |
| Implemented | Scoped offline screening pack | `backend/docs/offline-screening-28.md`, `offlineSync.ts`; no service worker |
| Config-dependent | Cognito staff identity and provider synchronization | Cognito client/config and provider-operation services; environment/provider evidence required |
| Config-dependent | OneMap, SES/SNS and Redis integrations | Provider adapters and environment settings exist; external delivery/availability is not claimed |
| Implemented | Pino/Pino HTTP structured and correlated logging | `backend/utils/logger/logger.js`, `backend/middlewares/httpLogger.js`, `backend/app.js`, and the HTTP logging tests |
| Planned | Installable PWA shell/service worker | `backend/docs/offline-screening-28.md` explicitly records this gap |
| Deferred | Eye-health station capture and offline path | The enum exists, but the current sync handler and frontend offline path support only three station types |
| Deferred | Participant self-service offline, full sync-centre UI and broader offline coverage | Explicitly out of scope in the offline implementation note |

## 4. Requirements and API map

The requirement-to-API inclusion point is
[`api-requirement-map.md`](api-requirement-map.md). It maps each core
requirement to the actual OpenAPI operation IDs, route/controller/service
sources, and current status. The map intentionally uses the current auth and
sync routes rather than the older illustrative `/auth/login` and
`/sync/batch` paths.

The core mapping is:

| Requirement | Current API evidence | Status |
| --- | --- | --- |
| FR-01 Event management | Event list/create/detail/update/delete, lifecycle commands, stations, shifts and memberships | Implemented in OpenAPI and event services |
| FR-02 Account and access management | Cognito authorize/callback/refresh, account administration, local event-role checks | Implemented/config-dependent at the provider boundary |
| FR-03 Participant registration | Participant search/create/update, consent, emergency contacts and event registration | Implemented |
| FR-04 Queue management | Event queues, station hand-off, join/call/start/advance/complete/skip/priority | Implemented |
| FR-05 Screening results and flags | Visual-acuity, refraction and colour-vision preview/save operations; server-side rules and acknowledgement | Implemented for three station types; eye-health deferred |
| FR-06 Review and referral | Review list/detail/decision and referral issue/revision/acknowledgement/document operations | Implemented |
| FR-07 Dashboard and reporting | Metrics, analytics, operations report and PDF/CSV export jobs | Implemented as source paths; no measured production result claimed |
| NFR-OFFLINE | `POST /api/v1/events/{eventId}/sync/screening`, encrypted IndexedDB pack and durable sync ledger | Implemented for scoped station flow |

## 5. PostgreSQL design and limitations

PostgreSQL is the selected persistence model. Prisma provides the normal
application access path, while PostgreSQL supplies foreign keys, unique
constraints, indexes, JSON/JSONB fields, transactions and database triggers
where migrations define them. Representative models include `User`,
`Event`, `Participant`, `EventRegistration`, `Station`, `QueueEntry`,
`ScreeningResult`, `Review`, `Referral`, `AuditLog`, `AuthAuditLog`,
`SyncAction` and `SyncActionTransition`.

The design has these explicit limitations:

- A PostgreSQL server and a valid `DATABASE_URL` are prerequisites; this
  repository does not provision a managed database or prove production
  capacity, backup recovery, replicas, encryption settings or availability.
- The database schema is migration-owned. `backend/db/init.sql` is a guard
  against the retired legacy schema and must not be used as a bootstrap.
- The current API performs clinical rule evaluation in the screening service;
  the client repeats a bounded preliminary evaluation for offline UX. Neither
  is a diagnosis engine.
- Report and analytics code contains PostgreSQL-specific aggregation such as
  continuous percentiles. Porting to another database would require a
  deliberate query and evidence review.
- The offline ledger persists safe metadata only; clinical bodies are accepted
  in the authenticated request and written through the normal screening
  services.

### Stored-procedure and function evidence

`backend/stored_procedures.sql` contains source evidence for timestamp and
clinical trigger functions, queue-transfer and screening procedures,
completion/category helper functions, a materialized view and a refresh
procedure. The file references legacy table names such as
`visual_acuity_results` and `station_queues`, while the canonical Prisma
schema uses models such as `ScreeningResult` and `QueueEntry`. It is therefore
reported as a database-design artifact, not as verified deployed behavior.

Migration-backed database functions/triggers that are part of the current
schema include timestamp maintenance and audit-log immutability guards; see
`backend/prisma/migrations/` for their SQL. A deployment claim for the
standalone procedure file requires a human-run schema compatibility review and
database execution evidence.

## 6. Security design

The implemented request path is:

```text
HTTPS request
  → request context / security headers / rate limits
  → authentication and session checks
  → event membership, role and duty authorization
  → Zod request validation
  → controller and service transaction
  → Prisma parameterized access
  → PostgreSQL constraints and audit records
```

Evidence-backed controls include:

- Secure-cookie Cognito session flow with CSRF handling; browser code does not
  receive refresh tokens or CSRF values from the refresh response.
- Backend authorization checks for global account state plus event membership,
  role and active duty; a global role name alone is not sufficient for station
  writes.
- Zod validation, bounded request bodies, safe problem responses, Helmet
  headers, exact CORS origins, rate limits and request IDs.
- Prisma transactions, idempotency keys and request fingerprints for sensitive
  writes and offline sync.
- Encrypted AES-GCM IndexedDB records bound to the authenticated owner and
  event; pass tokens are stripped from the offline queue snapshot and expired
  packs are purged.
- Append-only audit and authentication logs plus immutable database triggers
  in the current migrations.
- Dependency and contract checks available through the repository workflows.

The report does not claim an external firewall, managed secret store,
serverless runtime, object-storage deployment, live monitoring, backup restore,
or runtime artifact-signature verification because no repository evidence
proves those controls.

## 7. Verification record

The following commands are the locally verifiable checks for this branch. The
results below must be refreshed by the person preparing the final submission;
passing a local command does not prove cloud behavior.

```bash
pnpm --dir backend prisma:validate
pnpm --dir backend openapi:lint
pnpm --dir backend contracts:check
pnpm --dir backend test
pnpm --dir react-user-dashboard lint
pnpm --dir react-user-dashboard test
pnpm --dir react-user-dashboard build
pnpm check:api-collection
pnpm check:submission-package
```

No performance benchmark, live EC2 observation, external provider result or
demo rehearsal is inferred from these commands.

`pnpm package:submission` is a deterministic source-only archive of the
current committed repository. It does not create or include the PostgreSQL
database backup, complete the declaration/signature, create presentation
slides, or assemble the final combined package. The inclusion
check keeps the supplied project brief/guide files and the editable Mermaid
sources. It excludes only explicitly identified non-source material: the
incomplete diagram instructions, the dated progress log, the historical Week
0 log, the non-product UI preview, and the document explicitly labelled a
next-work plan; visual/reference assets and copied/generated packages under
`docs/images/` remain out unless they are one of the four supplied brief/guide
files.

## 8. 15-minute demo outline

The evidence-driven, unrehearsed run sheet is in
[`demo-outline.md`](demo-outline.md). It follows a path supported by the
current routes and frontend:

```text
login → event/participant operations → online screening
→ preloaded offline pack → offline save → reconnect and sync
→ review/referral → aggregate dashboard/report → security boundary recap
```

The offline segment must be prepared while online because there is no service
worker and the server must first issue a scoped station snapshot. The outline
calls out any precondition instead of presenting it as observed rehearsal.

## 9. Human-owned final inputs

These items intentionally remain open:

| Input | Repository state |
| --- | --- |
| Team names, student identifiers, report date and submission metadata | Human input in the report front matter |
| Official declaration, name, date and signature | Use `docs/ai-transcripts/DECLARATION_TEMPLATE.md`; no signature is supplied here |
| External AI/chat links, if required by the course | Use `docs/ai-transcripts/EXTERNAL_AI_CHAT_LINKS.md`; do not invent links |
| Lecturer/course-specific report formatting or manual report template | Apply manually to this source; no unverified template is claimed |
| PostgreSQL database backup | Supply separately from an authorized environment; the source-only packager neither creates nor includes it |
| Presentation slides and final combined submission package | Assemble manually according to the course process; the repository script is not that package |
| Lucidchart/Draw.io editable links or exported figures | The repository supplies editable Mermaid sources; add any official manual artifact only if a human has it |
| EC2, PostgreSQL, Cognito and HTTPS deployment screenshots/results | Collect manually from the authorized environment; none are claimed here |
| Demo rehearsal result and timings | Rehearse manually; this document is an outline only |

## 10. References

- [`backend/docs/openapi.yaml`](../../backend/docs/openapi.yaml)
- [`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma)
- [`backend/docs/offline-screening-28.md`](../../backend/docs/offline-screening-28.md)
- [`backend/services/SERVICES.md`](../../backend/services/SERVICES.md)
- [`README.md`](../../README.md)
- [`docs/featureList.md`](../featureList.md)
- [`diagrams/`](diagrams/)
