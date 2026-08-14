# Registration stored routines

VSMS uses four PostgreSQL stored functions for registration operations whose correctness depends on a shared event lock or a consistent aggregate. Authentication, event assignment, request validation, API projection, and request-aware audit records remain in Express. Database invariants and tightly coupled row changes remain in PostgreSQL.

## Implementation map

| Routine | Application entry point | Database-owned invariant | Application-owned work |
| --- | --- | --- | --- |
| `register_participant_for_event` | `registrationService.createRegistration` through `registrationRoutineRepository.registerParticipant` | Event capacity lock, idempotent replay, duplicate prevention, waitlist decision, initial status history | RBAC and participant-event scope, QR provisioning, route state, request audit |
| `cancel_event_registration` | `registrationService.changeRegistrationStatus` through `registrationRoutineRepository.cancelRegistration` | Registration/event lock, cancellation, active QR revocation, oldest-waitlisted promotion, both history rows and one shared timestamp | RBAC, request audit, promoted participant QR provisioning |
| `check_in_event_registration` | `qrService.manualCheckIn` through `registrationRoutineRepository.checkInRegistration` | Registration lock, signed-up-only transition, attendance timestamp and status history | QR validation, RBAC, route assignment and request audit |
| `get_event_registration_summary` | `registrationService.getEventRegistrationSummary` through `registrationRoutineRepository.getEventSummary` | Stable, identity-free aggregate over event capacity and lifecycle states | RBAC and API projection |

The repository is the only raw-SQL adapter for these functions. Prisma tagged queries bind every value as a parameter.

## Transaction boundary

```text
HTTP request
  -> controller validation and staff assignment check
  -> Prisma transaction
     -> stored routine locks and changes invariant rows
     -> application audit and route/QR follow-up
  -> commit once, or roll back everything
```

Cancellation revokes every active QR pass inside the routine before returning. This prevents any legitimate internal database caller from leaving a cancelled registration with a valid bearer pass. PostgreSQL returns `revoked_qr_count`; the service converts the `BIGINT` to a JSON-safe number for the immutable application audit.

## Security and verification

- All four functions are `SECURITY INVOKER` with `search_path = pg_catalog, public`.
- `PUBLIC` execution is revoked; production grants only explicit signatures to `vsms_runtime`.
- Prisma migrations are the only executable deployment authority. `Stored_Procedures/Keefe_stored_procedures.sql` is a readable catalogue, not a competing SQL copy.
- `tests/integration/registration-routines.integration.test.js` proves concurrency, replay, QR closure, waitlist promotion, check-in, summaries, routine metadata, and privileges against a freshly migrated PostgreSQL database.
