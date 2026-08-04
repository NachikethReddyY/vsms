# Issue #7 — Event Lifecycle and Details Plan

## Goal

Implement authenticated event creation, viewing, editing, publishing, starting,
completing, and cancellation with capacity and schedule enforcement. Deliver the
Express/Prisma backend and its verification before building the tablet/desktop
React experience. Keep OpenAPI, seeded demonstration data, Prisma migrations,
and `erd.md` synchronized with the implementation.

## Scope and sequencing

1. Establish secure backend foundations and tests.
2. Implement and test the event domain, persistence, REST API, authorization,
   audit trail, state machine, concurrency control, and OpenAPI contract.
3. Seed demonstrable event lifecycle states.
4. Build the React experience against the completed API contract.
5. Verify accessibility, responsive tablet/desktop layouts, security controls,
   dependency health, and end-to-end critical paths.

The frontend must not begin until the backend implementation, migrations,
OpenAPI contract, and backend tests pass.

## Foundations

| Area | Locked decision | Rationale and rejected alternatives |
|---|---|---|
| Database schema | Treat the supplied 30-table platform ERD as the target domain model; limit issue #7 Prisma work to the existing branch subset, `Event.version`/timezone, actor relations, and append-only `EventAuditLog`; stop populated migrations for explicit identity reconciliation; update `erd.md` with every schema change. | Avoids fabricating the reference participant/registration/identity tables while preserving a safe event delivery path. |
| TypeScript types | Treat OpenAPI as the API contract and generate TypeScript request/response types for React; keep the CommonJS backend and add JSDoc domain types where useful. | Avoids drifting DTO copies without expanding this feature into a backend TypeScript migration. |
| Validation | Use Zod at Express boundaries and with React Hook Form; the server is authoritative and database constraints are final. | Rejected hand-written validation because rules would drift and cross-field validation would be fragile. |
| Routing | Explicit REST commands for lifecycle transitions and separate React routes for list, create, detail, and edit. | Rejected a generic status patch because dedicated actions make authorization and legal transitions explicit. |
| Authentication and authorization | Keep the user-facing login simple (username or email plus password), but retain bcrypt, a short-lived memory-only access token, and rotating secure HttpOnly refresh cookies; central authentication reloads current role/status and event authorization remains database-backed. | This follows the owner's simple-login direction without removing the cookie boundary or pretending the reference `User_Credentials`/role model is already migrated. |
| CSS | Tailwind v4 utilities backed by the exact tokens and rules in `design/design.md`. | Rejected a second CSS methodology because Tailwind already exists and mixed styling would drift. |
| UI framework | Use accessible local/headless React primitives and the repository design system; do not add an opinionated component suite. | Avoids default-library styling that conflicts with the precision-instrument design language. |
| Client-server communication | HTTPS REST via the existing Axios client, environment-based base URL, secure credentials, normalized errors, request cancellation, duplicate-submit protection, and optimistic concurrency. | Rejected GraphQL/tRPC and mixed patterns as unnecessary scope and coupling. |
| Folder structure | Backend feature layers (`routes`, `controllers`, `services`, `repositories`, `schemas`, middleware, tests); frontend feature colocation under `src/features/events` plus shared UI primitives. | Rejected continuing controller-heavy and generic `components` placement because the lifecycle logic needs explicit boundaries. |

## Backend design

### Temporary identity boundary for issue #7

- Add `SystemRole` (`ADMIN`, `EVENT_MANAGER`, `STAFF`) and `UserStatus`
  (`ACTIVE`, `DISABLED`) enums.
- Add a UUID-backed `User` model mapped to `users` with normalized unique email,
  `passwordHash`, system role, status, failed-login counters/lock timestamp, and
  audit timestamps. Never expose `passwordHash` or authentication counters.
- Retain the `RefreshSession` table for hashed one-time cookie tokens, rotation,
  family revocation, and reuse evidence. React keeps access tokens only in memory.
- The supplied platform ERD separates `User`, `User_Credentials`, `Role`,
  `UserRole`, and `Permissions`. Issue #7 keeps the branch's temporary flat
  `User` identity only to support a simple login; reconciliation is a deployment
  prerequisite, not an implicit migration.
- Connect every currently unresolved actor/user UUID in the Prisma schema to
  the canonical `User` model with named relations and deletion restricted or
  set-null according to whether the actor is mandatory.
- `backend/db/init.sql` is legacy and incompatible (`SERIAL` IDs and plaintext
  `password`). Replace it with Prisma migrations/seeding and do not run it.
- Before migration, run a preflight data check. If a deployed legacy integer-ID
  `users` table contains rows, stop and use a one-time migration that creates
  UUID users by normalized email and requires password reset; plaintext values
  are never copied into `passwordHash`. Fresh databases use the normal Prisma
  migration directly.
- Migrating a populated legacy user table and delivering password resets is a
  deployment prerequisite outside issue #7. Production startup and event API
  enablement remain blocked until that prerequisite is completed and evidenced.

### Event schema and migration

- Add `version Int @default(1)` to `Event`.
- Add `EventAuditAction` with create, update, publish, start, complete, and
  cancel actions.
- Add `EventAuditLog` with an immutable UUID key, `eventId`, `actorUserId`,
  action, redacted before/after JSON, request correlation ID, and timestamp.
- Relate audit rows to events with restricted deletion and index
  `(eventId, createdAt)` plus correlation ID as appropriate.
- Add database checks through migration SQL where Prisma cannot express them:
  capacity must be positive, `endsAt > startsAt`, cancellation metadata must be
  internally consistent, and version must remain positive.
- Update `erd.md` in the same patch and validate schema/migration consistency.
- Keep Registration and Station UUIDs explicitly unresolved in this issue; no
  fabricated foreign keys are added until their canonical models return.
- Enforce audit immutability with a PostgreSQL trigger rejecting UPDATE/DELETE
  and a runtime database role that has SELECT/INSERT only on event audit rows.
  Retain event audit rows for the event's regulated retention period; the exact
  production duration is deployment policy and cannot be shortened by the API.

### State machine

Allowed transitions:

- `DRAFT -> PUBLISHED`
- `PUBLISHED -> IN_PROGRESS`
- `IN_PROGRESS -> COMPLETED`
- `DRAFT -> CANCELLED`
- `PUBLISHED -> CANCELLED`
- `IN_PROGRESS -> CANCELLED` only for `ADMIN`; an event manager must escalate
  the request. The administrator must supply a required reason.

Completed and cancelled events are terminal. Generic edits cannot directly
change status. Draft events allow all validated detail/schedule edits. Published
events allow name, description, venue, future schedule, and capacity edits.
In-progress events allow description and capacity increases only. Completed or
cancelled events reject PATCH. Capacity may never be reduced for an in-progress
event; active/completed shifts cannot be changed or removed.

### API

- `GET /api/events` — authorized, filterable, cursor-paginated list.
- `POST /api/events` — create a draft and audit it.
- `GET /api/events/:eventId` — authorized detail.
- `PATCH /api/events/:eventId` — update allowed fields using an expected
  version; return `409` on stale writes.
- `POST /api/events/:eventId/publish`
- `POST /api/events/:eventId/start`
- `POST /api/events/:eventId/complete`
- `POST /api/events/:eventId/cancel`
- `GET /api/events/:eventId/audit-log` — role-gated and paginated.

Event lists use `(startsAt, eventId)` as the stable ascending composite cursor;
audit history uses `(createdAt, eventAuditLogId)` descending. Cursors are
base64url-encoded signed payloads bound to normalized filters, page size, and
sort order; malformed, tampered, or mismatched cursors are rejected. Event
pages default to 25 and max at 100; audit pages default to 50 and max at 100.

Controllers translate HTTP only. Services own authorization-aware lifecycle
rules and transactions. Repositories contain bounded Prisma queries. Every
mutation writes its event change and audit row in one database transaction.

Shifts are part of the Event aggregate for issue #7. Create accepts an optional
bounded `shifts` array. PATCH accepts the complete desired shift set plus the
event version; the service creates, updates, and removes only planned shifts in
the same event/version/audit transaction. Every shift must be within event
bounds, have `endsAt > startsAt`, use a stable UUID on edit, and have unique
`(name, startsAt)` within its event. Active/completed shifts cannot be removed.
There are no independent shift mutation routes in this issue.

The atomic update uses `updateMany({ eventId, version })`, increments `version`,
and proceeds with shifts and one audit insert only when exactly one event row
matched. A stale write returns `409`; transaction failure leaves the event,
shifts, version, and audit history unchanged.

### Authorization matrix

| Action | `ADMIN` | `EVENT_MANAGER` | Assigned `STAFF` | Unassigned staff |
|---|---|---|---|---|
| List | All events | Created/managed/assigned events | Assigned events | None |
| Create | Yes | Yes | No | No |
| View detail | All | Created/managed/assigned | Assigned | No |
| Edit/publish/start/complete/cancel | All | Events created by them or where a shift assignment grants `EVENT_MANAGER` | No | No |
| Read event audit | All | Managed events | No | No |

Authorization filters are applied before pagination. The server obtains user ID
and system role only from the verified access token and confirms mutable event
permissions against current database state. Client-provided actor/role values
are ignored. Missing and unauthorized resource lookups use a uniform response
where disclosure would enable enumeration.

### Validation and error contract

- Reject unknown object keys and non-JSON content types.
- Enforce UUID formats, normalized bounded strings, positive bounded capacity,
  IANA timezone identifiers, timestamps with offsets, and end-after-start.
- Require a bounded cancellation reason for cancellation.
- Map errors to a consistent problem-details shape without stack traces or
  internal database details.
- Distinguish `400`, `401`, `403`, `404`, `409`, `415`, `422`, `429`, and `500`.
- Use uniform not-found/forbidden behavior where resource enumeration is a risk.

For issue #7, capacity means the validated event configuration limit (`1` to
`100000`). The current schema intentionally has no canonical registration model
or registration endpoint after prior migrations removed those tables, so this
issue does not claim occupancy/overbooking enforcement. The future registration
feature must enforce `confirmed registrations < Event.capacity` transactionally
and must reject capacity reductions below confirmed occupancy. OpenAPI and UI
copy must not display a fabricated registered count.

### Authentication and transport prerequisites

The current authentication implementation returns mock tokens, compares
plaintext passwords, leaves user listing unprotected, stores browser tokens in
local storage, and has unrestricted CORS. These are existing vulnerabilities,
so event endpoints cannot safely ship on top of it.

- Verify stored bcrypt hashes with timing-safe library behavior.
- Sign short-lived JWT access tokens with explicit algorithm, issuer, audience,
  expiry, and key sourced from environment/secret management.
- Return a short-lived access token plus a CSRF value; keep the refresh token in
  a Secure, HttpOnly, SameSite=Strict cookie and never persist either token in
  local/session storage.
- Add role/assignment authorization middleware with deny-by-default behavior.
- Restrict CORS to configured HTTPS origins with credentials and no wildcard.
- Use Helmet, request/body limits, parameter pollution protection where needed,
  authentication and mutation rate limits, safe logging, correlation IDs, and a
  central error handler.
- Require HTTPS in deployed environments, trust only the configured proxy, and
  redirect/reject insecure requests at the edge/application boundary. Local
  development uses the existing trusted development certificates.
- Remove hard-coded HTTP API and example refresh URLs from the frontend.

Authentication endpoints are `/auth/signup`, `/auth/login`, `/auth/refresh`,
and `/auth/logout`. Staff signup is disabled by default and returns the same
not-found boundary as an unavailable route unless an administrator explicitly
sets `PUBLIC_SIGNUP_ENABLED=true`. Seeded/admin-provisioned accounts remain the
production default until the platform `User_Credentials` and invitation flow
are implemented.

Protected requests load current `User.status` and `User.systemRole` from the
database, so disabling an account or changing its role takes effect immediately
despite an otherwise valid access token. `SystemRole.EVENT_MANAGER` and
`StaffAssignmentRole.EVENT_MANAGER` are separate authorization inputs with
distinct fixtures and policy branches.

### Audit properties

- Audit events are append-only and created server-side.
- The current delete flow preserves `EventAuditLog` retention rows and writes an
  `AuditLog` tombstone only after the event delete succeeds in the same
  transaction. Do not describe `EventAuditLog` as the current lifecycle mutation
  feed, and do not claim rejected attempts are currently recorded there.
- Snapshot only allowlisted event fields; never include tokens, secrets,
  passwords, or sensitive headers.
- Never allow client-controlled actor IDs, timestamps, or audit actions.
- Log rejected security-relevant actions separately without exposing protected
  resource contents.

### Seed data and documentation

- Add idempotent seed data for draft, published, in-progress, completed, and
  cancelled events, including shifts and safe audit examples.
- Document all schemas, commands, status codes, authentication requirements,
  pagination, conflict behavior, and examples in `backend/docs/openapi.yaml`.
- Generate frontend API types from that contract and check generation drift.

Use `@redocly/cli` to lint OpenAPI and `openapi-typescript` to generate
`react-user-dashboard/src/generated/api.ts`. `contracts:check` regenerates into
a temporary file and fails on drift. OpenAPI uses relative server URLs or HTTPS
servers only and documents the refresh cookie/CSRF scheme separately from
bearer access tokens.

## Frontend design

### Routes and user journeys

- `/events`: operational list with status, date, venue, capacity, loading,
  empty, partial, permission, offline, and failure states.
- `/events/new`: focused Luma-inspired creation journey using repository design
  tokens, logical schedule/capacity sections, readiness summary, save draft,
  and publish actions.
- `/events/:eventId`: event details with restrained status, schedule, capacity,
  safe lifecycle actions, and role-appropriate audit history.
- `/events/:eventId/edit`: prefilled form with version conflict recovery.

All routes live inside the `design.md` application shell. Events is a primary
sidebar destination; the 52px command bar carries global/event search, sync,
help, and account controls. Route content never adds a duplicate page header.

Visual priority is locked as follows:

1. List: event context and Create action; filters/search; event rows and paging.
2. Create/edit: event identity and validation state; schedule/details fields;
   readiness summary and actions.
3. Detail: event identity/status/time; operational lifecycle action; schedule
   and capacity; secondary metadata and authorized audit history.

Save draft is primary until publish readiness passes. When ready, Publish is
primary and Save draft becomes secondary. Disabled publish links its reason to
the readiness summary. Publish and Start require lightweight confirmation;
Complete requires confirmation with terminal-state language; Cancel uses the
strong destructive dialog already specified. All transitions expose pending,
single-submit, repeated-command, success, failure, and post-action focus rules.

### Responsive layout

- Optimize for 768px tablet through wide desktop.
- At desktop widths use a fluid form/workspace plus a restrained sticky summary
  rail; below approximately 1100px turn the summary into an inline section or
  accessible drawer without hiding required information.
- Use 44px minimum operational targets, keyboard-complete navigation, visible
  focus, semantic landmarks, explicit labels, field-level and summary errors,
  and focus movement to the first invalid field or result message.
- Prevent document-level horizontal scrolling and test zoom/reflow.

### Visual language

- Follow `design/design.md`: warm cream canvas, warm ink, white dominant
  workspace, one blue interaction accent, semantic status colors only,
  hairline separators, 400/600 weights, 8px controls, and no card grid,
  gradients, glass effects, or decorative shadows.
- Borrow Luma's clarity, staged disclosure, and event summary behavior as
  interaction inspiration only; do not reproduce its branding or styling.
- Provide dark theme behavior only through the defined tokens.

### UI states

Define loading, skeleton/partial, empty, success, validation, permission,
conflict, offline, retryable failure, terminal event, disabled, hover, focus,
and reduced-motion behavior. Destructive cancellation requires a confirmation
dialog, reason, explicit event identity, safe focus trapping/restoration, and
non-color warning language.

Also define unsaved-change navigation interception, session-refresh pending,
first-use empty, filtered empty, pagination exhausted, and stale cached-data
states. Toast/status feedback uses polite or assertive live regions as
appropriate. The tablet summary drawer has a named trigger, initial focus,
Escape close, inert background, focus trap, and focus restoration. Dates expose
an unambiguous local value, IANA timezone, and machine-readable timestamp.

## OWASP-oriented controls

| Category | Planned controls and verification |
|---|---|
| A01 Broken Access Control | Deny-by-default middleware, per-action roles/assignments, IDOR integration matrix, uniform lookup failures. |
| A02 Cryptographic Failures | HTTPS enforcement, secure cookies, bounded JWT algorithms/claims, secret hygiene, hashed refresh tokens and passwords. |
| A03 Injection | Strict Zod schemas, Prisma parameterization, React escaping, no raw HTML, header/log sanitization, malicious payload tests. |
| A04 Insecure Design | Explicit state machine, transactional audit, optimistic concurrency, threat-model review, safe failure modes. |
| A05 Security Misconfiguration | Restricted CORS, Helmet/CSP, body limits, production error handling, proxy/TLS configuration tests. |
| A06 Vulnerable Components | Lockfiles, production dependency audit, direct dependency review, remediation or documented blocker for known exploitable CVEs. |
| A07 Auth Failures | bcrypt, rate limiting, short token lifetime, rotating refresh families, CSRF defense, revocation/reuse tests. |
| A08 Integrity Failures | Lockfile integrity, controlled JSON parsing, server-owned audit values, generated contract drift checks. |
| A09 Logging and Monitoring | Correlation IDs, append-only domain audit, auth/security event logs, redaction tests, documented production alerting requirement. |
| A10 SSRF | No URL-fetching feature; reject unexpected URL-shaped fields and add regression tests if any external endpoint is later introduced. |

This work can demonstrate controls against the OWASP Top 10, but production
assurance also depends on deployment TLS, secret storage, database privileges,
monitoring, backups, and infrastructure outside this repository.

## Test strategy

### Backend

- Unit tests for validation, transition matrix, permissions, redaction, and
  error mapping.
- Integration tests against an isolated PostgreSQL database for every endpoint,
  transaction rollback, audit atomicity, pagination, stale versions, duplicate
  commands, invalid transition races, and database constraints.
- Authentication tests for password verification, token claims, refresh
  rotation/reuse, logout/revocation, CSRF, CORS, rate limits, expired tokens,
  malformed headers, and unauthorized/forbidden/IDOR cases.
- Property/boundary cases for field lengths, Unicode, timestamps, DST, capacity,
  malformed JSON, unknown keys, and injection/XSS payloads.

Use Vitest for backend unit/integration tests and Supertest against an exported
`app` from `backend/app.js`; `server.js` only validates environment and listens.
Use a dedicated `TEST_DATABASE_URL`, apply Prisma migrations once per test run,
and reset data between suites with deterministic factories, clock, JWT keys,
and CSRF values. Tests refuse to start unless the database name clearly ends in
`_test`. CI runs schema validation, migrations, unit/integration tests, OpenAPI
lint/type drift, dependency audit, and static security checks.

Legacy preflight tests cover fresh databases, empty and populated legacy tables,
normalized-email collisions, hard-stop behavior, and proof that plaintext
credentials are neither copied nor logged. Authentication acceptance covers
failed-login locking, disabled users, status/role changes, simultaneous refresh,
reuse, logout cookie clearing, and uniform unknown-email/bad-password behavior.
Audit tests prove the API has no mutation route, trigger-level UPDATE/DELETE
rejection, runtime-role least privilege, restricted event deletion, and expected
privileged migration behavior.

Numeric limits are locked: request bodies max at 256 KiB; names 1–150 chars;
descriptions 5,000; venues 1–255; cancellation reasons 10–1,000; 50 shifts per
event; shift names 1–100; list/audit pages max 100. Login is limited to 5 failed
attempts per normalized account and 20 attempts per IP per 15 minutes, followed
by a 15-minute account lock; mutation endpoints use a documented configurable
per-user/IP limiter with deterministic retry headers. Performance fixtures use
at least 10,000 events and 100,000 audit rows and assert bounded query counts;
environment-specific latency budgets are recorded rather than falsely treated
as portable constants.

### Frontend and end-to-end

- Component tests for forms, validation summary, permissions, conflict recovery,
  dialogs, disabled/loading behavior, and API error normalization.
- E2E tests for create draft, publish, view, edit, concurrent edit conflict,
  start, complete, cancel, denied action, expired session, network failure, and
  seeded demonstration data.
- Accessibility checks with automated tooling plus keyboard/focus/manual screen
  reader spot checks.
- Responsive checks at representative tablet, laptop, desktop, zoom, and
  reduced-motion configurations.

Use Vitest plus React Testing Library and `jest-axe` for components, and
Playwright for E2E. Browser coverage is current Chromium, Firefox, and WebKit at
768x1024, 1100x800, and 1440x900, plus Chromium at 200% zoom/reflow,
keyboard-only, dark theme, forced offline, and reduced motion.

### Security verification

- Production dependency audits for backend and frontend.
- Static review for secrets, unsafe HTML, raw queries, command execution,
  insecure randomness, permissive CORS, and HTTP URLs.
- Dynamic negative tests covering OWASP categories relevant to this surface.
- No claim of absolute invulnerability; unresolved exploitable findings block
  completion and are reported with evidence.

## Completion criteria

- Backend precedes frontend and all backend tests pass before UI work starts.
- Every event mutation is authorized, validated, concurrency-safe, and audited.
- Prisma schema, migration, seed data, OpenAPI, generated frontend types, and
  `erd.md` agree.
- All specified UI states and tablet/desktop breakpoints are demonstrable.
- Relevant test suites, lint, builds, dependency audits, and security checks
  pass with no known exploitable high/critical issue in this feature.
- Reviewer concerns are either resolved and re-reviewed or explicitly accepted
  by the user through the preflight human-review gate.
