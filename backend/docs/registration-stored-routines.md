# Registration stored routines

VSMS uses four PostgreSQL stored functions for the registration operations whose correctness depends on a shared event lock or a consistent aggregate. They are deliberately small: authentication, event assignment, request validation, API projection, and application audit records remain in Express; database invariants and tightly coupled row changes remain in PostgreSQL.

## Implementation map

| Routine | Application entry point | Database-owned invariant | Application-owned work |
| --- | --- | --- | --- |
| `register_participant_for_event` | `registrationService.createRegistration` through `registrationRoutineRepository.registerParticipant` | Event-row capacity lock, idempotent replay, duplicate prevention, waitlist decision, initial status history | RBAC and participant-event scope, QR provisioning, route state, application audit |
| `cancel_event_registration` | `registrationService.changeRegistrationStatus` through `registrationRoutineRepository.cancelRegistration` | Registration/event lock, cancellation, active QR revocation, oldest-waitlisted promotion, both history rows and one shared timestamp | RBAC, application audit, promoted participant QR provisioning |
| `check_in_event_registration` | `qrService.manualCheckIn` through `registrationRoutineRepository.checkInRegistration` | Registration lock, signed-up-only transition, attendance timestamp and status history | QR validation, RBAC, route assignment and application audit |
| `get_event_registration_summary` | `registrationService.getEventRegistrationSummary` through `registrationRoutineRepository.getEventSummary` | One stable, identity-free aggregate over event capacity and lifecycle states | RBAC and public API projection |

The repository is the only raw-SQL adapter for these functions. Parameter interpolation uses Prisma tagged queries, so values remain bound parameters instead of becoming SQL text.

## Transaction boundaries

```text
HTTP request
  -> controller validation and staff assignment check
  -> Prisma transaction
     -> stored routine locks and changes invariant rows
     -> application audit and route/QR follow-up
  -> commit once, or roll back everything
```

Cancellation is intentionally stronger: the routine itself revokes every active QR pass before returning. This prevents an internal database caller from creating a cancelled registration with a still-valid bearer pass. The returned `revoked_qr_count` is converted from PostgreSQL `BIGINT` to a JSON-safe number and included in the application audit record.

## Security controls

- Every routine is `SECURITY INVOKER`; it never inherits an owner's wider rights.
- Every routine fixes `search_path` to the trusted `pg_catalog, public` schemas; routines that mutate lifecycle state also schema-qualify application relations.
- `PUBLIC` execution is revoked. Production grants only the four signatures to `vsms_runtime` through `prisma/runtime-role.example.sql`.
- Mutations use row locks and write status history in the same transaction.
- Routine comments are stored in `pg_catalog`, making purpose visible to database reviewers and tooling.
- The API still performs RBAC before calling a routine. The database function is not an authentication boundary.

## Verification

The fresh-database integration suite proves:

1. two simultaneous registrations for a one-place event produce exactly one `SIGNED_UP` and one `WAITLISTED` row;
2. exact idempotent replay returns the existing registration;
3. cancellation revokes active QR passes, promotes the oldest waiter, and records both transitions atomically;
4. the promoted participant can check in and the aggregate remains consistent;
5. the PostgreSQL catalog reports invoker security, the fixed search path, revoked public execution, stable summary volatility, and non-empty descriptions.

Run the evidence with:

```sh
pnpm --dir backend test:integration
pnpm test:availability
```

These are stored **functions** in PostgreSQL terminology because each returns an operation receipt. In a project presentation, “stored routines” is the accurate umbrella term; they are not `CREATE PROCEDURE` objects invoked with `CALL`.
