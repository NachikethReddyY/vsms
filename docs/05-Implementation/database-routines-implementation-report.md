# VSMS Stored Procedures and Database Routines

## Purpose

VSMS uses PostgreSQL routines for operations that benefit from atomic execution,
aggregate computation, or database-level integrity enforcement. Authorization,
clinical policy, and audit attribution remain in the Express service layer because
they depend on the authenticated staff member, event assignment, request metadata,
and versioned clinical rules.

The executable database definitions are deployed through the Prisma migration at
`backend/prisma/migrations/20260814200000_add_database_routines/migration.sql`.
The file `backend/Stored_Procedures/Keefe_stored_procedures.sql` is a catalogue,
not a second copy of the executable SQL. This prevents the report copy and the
production schema from drifting apart.

## Implementation status

| Submitted object | Status | Production implementation |
| --- | --- | --- |
| Participant timestamp trigger | Implemented | `fn_update_timestamp` and `trg_participants_updated_at`, deployed by migration `20260806020000_add_updated_at_trigger` |
| Visual-acuity auto-flag trigger | Replaced intentionally | Versioned, station-specific evaluation in `screeningService.js`; results and applied rule versions are stored in `screening_results` |
| Queue audit trigger | Replaced intentionally | Transactional audit records in `queueService.js` and `reviewService.js`, including actor, event, request, and before/after context |
| Participant station-transfer procedure | Implemented in service transaction | `queueService.js` applies RBAC, route validation, queue movement, and audit writes atomically; database triggers enforce same-event station scope |
| Visual-acuity upsert procedure | Replaced intentionally | Current screening service validates dynamic schemas and writes JSON results for every station type; the obsolete single-table adapter was removed |
| Cancel active queue procedure | Implemented and connected | `sp_vsms_cancel_active_registration_queue` validates event scope, closes active rows, returns the affected count, and is called by urgent clinical review |
| Participant completion UDF | Implemented with corrected semantics | `vsms_registration_route_complete` checks the registration's persisted, event-scoped route and requires at least one route step |
| Visual-acuity category UDF | Replaced intentionally | Central clinical rule engine avoids a second set of thresholds in PostgreSQL |
| Daily materialized view and refresh procedure | Replaced intentionally | `vsms_event_queue_statistics` computes live PII-free counts and p50/p90 timings without stale data or refresh-job failure modes |

The original SQL could not be installed safely because it referenced tables and
columns that are no longer in the Prisma schema, including `queue_entry`,
`station_queues`, `visual_acuity_results`, and `screening_stations`. The improved
implementation uses `queue_entries`, `event_registrations`, `stations`,
`registration_route_steps`, and `screening_results`.

## Security and integrity controls

The routines use `SECURITY INVOKER` and a fixed `search_path`, so they execute with
the caller's permissions and cannot be redirected to attacker-controlled objects.
PostgreSQL's default public execution grant is revoked. The restricted application
role receives only the required routine grants through
`backend/prisma/runtime-role.example.sql`.

Every registration-to-station relationship is checked in PostgreSQL. Inserts and
relevant updates to route steps, queue entries, screening results, and queue
movements are rejected if a station belongs to a different event. The migration
also checks existing records first and fails rather than silently preserving
invalid cross-event data.

These controls support the CIA triad:

- Confidentiality: analytics return aggregate values only, and runtime execution
  is restricted to the application role.
- Integrity: triggers prevent cross-event records, while routines validate IDs and
  preserve atomic queue state changes.
- Availability: live bounded aggregates avoid materialized-view refresh failures,
  and cancellation is idempotent so retries are safe.

## Application integration

`backend/utils/database/databaseRoutines.js` is the only application adapter for
these routines. Parameterized Prisma SQL prevents string interpolation attacks.
The analytics service calls the queue-statistics function, and urgent clinical
review calls the cancellation procedure inside its existing transaction. RBAC is
checked before either database call.

## Verification

The PostgreSQL integration tests are stored in
`backend/.vsms/tests/database-routines.integration.test.js`. They verify:

- deterministic queue counts and percentile calculations;
- invalid analytics intervals and event identifiers;
- scoped, idempotent cancellation and its affected-row count;
- non-empty route-completion semantics;
- automatic participant timestamps after direct SQL updates; and
- rejection of cross-event queue, route, result, and movement records.

The unit tests also verify that analytics and urgent review use the database
adapters. `pnpm test:integration` prepares a disposable test database, applies all
Prisma migrations in order, and includes the `.vsms` database-routine suite.

## Controlled migration deployment

Prisma migration files are the production schema source of truth. The GitHub
Actions quality job prepares a fresh PostgreSQL 16 database and requires
`prisma migrate status` to be clean. A release then creates and verifies an
encrypted RDS snapshot before launching one dedicated Fargate migration task.
That task alone receives the privileged migration URL and runs
`prisma migrate deploy` followed by `prisma migrate status`. A failure prevents
the new API and worker image from being promoted.

Runtime tasks use only the restricted `vsms_runtime` role and never execute
migrations on startup. Existing applied migrations are not edited; corrections
are delivered as reviewed forward-fix migrations. Application rollback retains
the previous image digest, while database recovery is tested by restoring the
snapshot or point-in-time state to an isolated instance. The implementation and
operator configuration are documented in
`docs/07-Operations/controlled-release-pipeline.md`.

Verification performed on 14 August 2026 produced the following evidence:

- Prisma schema validation: passed;
- affected unit tests: 28 passed and 0 failed;
- complete backend unit/security suite: 421 passed, 5 skipped, and 0 failed;
- PostgreSQL 16 migration reset: all migrations applied successfully;
- database-routine integration suite: 5 passed and 0 failed; and
- full backend integration run: 79 passed, with two unrelated event-response
  assertions failing and counted once more through their failed parent suite.

The two event assertions expect the earlier inline artwork data URL and a staff
object without the newer `fullName` field. This branch changes neither event
response and does not hide those existing integration-test maintenance items.

## Conclusion

All useful requirements from the submitted SQL are implemented either as current
PostgreSQL routines or as service-layer controls with stronger security and domain
context. The obsolete SQL objects are deliberately not installed because doing so
would duplicate business rules, weaken audit attribution, and target tables that
do not exist in the production schema.
