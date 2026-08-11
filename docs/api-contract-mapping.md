# School API and behavior contract map

This is a local-evidence map from the required surface in [the client brief](vsms-client-brief.md#6-required-api-surface) to `backend/docs/openapi.yaml`, the mounted Express routes, and their authorization middleware. “Exact” means the required method/path is present. “Equivalent” means the same behavior is deliberately exposed through a more constrained route or protocol. “Missing” means no equivalent route was found locally.

## Required API surface

| School requirement | Actual OpenAPI and route | Authorization rule | Status |
| --- | --- | --- | --- |
| `POST /api/v1/auth/login` | No local-password login route. `GET /api/v1/auth/authorize` (`authorizeWithCognito`) redirects to managed login and `GET /api/v1/auth/callback` (`completeCognitoAuthorization`) exchanges the code. | Public, rate-limited managed-login endpoints; callback verifies Cognito tokens before local account checks. | Equivalent — Cognito authorization-code + PKCE replaces a local login POST. |
| `POST /api/v1/auth/logout` | `POST /api/v1/auth/logout` (`logout`). | No bearer middleware; clears browser cookies. Cookie-authenticated browser mutations still pass global CSRF checks. | Exact. |
| `POST /api/v1/auth/refresh` | `POST /api/v1/auth/refresh` (`refreshSession`). | OpenAPI `refreshCookie` security; rate limited; global CSRF applies when refresh/CSRF cookies are present. | Exact. |
| `POST /api/v1/events` | `POST /api/v1/events` (`createEvent`). | Mounted behind `authenticate`; `requireSystemRole("ADMIN")`. | Exact. |
| `GET /api/v1/events` | `GET /api/v1/events` (`listEvents`). | Mounted behind `authenticate`; service filters to visible events. | Exact. |
| `PUT /api/v1/events/{id}` | `PATCH /api/v1/events/{eventId}` (`updateEvent`). | Authenticated approved account plus `requireEventManager`; Zod validation and optimistic concurrency. | Equivalent — partial update is the implemented contract, so no PUT route is claimed. |
| `DELETE /api/v1/events/{id}` | `DELETE /api/v1/events/{eventId}` (`deleteTerminalEvent`). | Authenticated approved account plus administrator role; service permits deletion unless the event is in progress. | Exact path/method; ongoing events are protected. |
| `POST /api/v1/participants` | `POST /api/v1/participants` (`createParticipant`). | `requireAuthentication`, operational `REGISTRATION_OFFICER`, active registration assignment, and `participants:write`. | Exact. |
| `GET /api/v1/participants` | `GET /api/v1/participants` (`searchParticipants`). | Same registration context plus `participants:read`. | Exact. |
| `PUT /api/v1/participants/{id}` | `PATCH /api/v1/participants/{participantId}` (`updateParticipant`). | Same registration context plus `participants:write`; participant event scope is checked in the service. | Equivalent — partial update is the implemented contract, so no PUT route is claimed. |
| `POST /api/v1/screenings/visual-acuity` | `POST /api/v1/events/{eventId}/stations/{stationId}/visual-acuity` (`saveVisualAcuity`). | Authenticated approved account; service requires the caller's active screener duty for the event/station. | Equivalent — explicit event and station scope prevents cross-event/station writes. |
| `POST /api/v1/screenings/refraction` | `POST /api/v1/events/{eventId}/stations/{stationId}/refraction` (`saveRefraction`). | Authenticated approved account; active screener duty for the event/station. | Equivalent — event-scoped deviation. |
| `POST /api/v1/screenings/colour-vision` | `POST /api/v1/events/{eventId}/stations/{stationId}/colour-vision` (`saveColourVision`). | Authenticated approved account; active screener duty for the event/station. | Equivalent — event-scoped deviation. |
| `POST /api/v1/screenings/eye-health` | `POST /api/v1/events/{eventId}/stations/{stationId}/eye-health` (`saveEyeHealth`). | Authenticated approved account; active screener duty for the event/station. | Equivalent — event-scoped deviation. |
| `POST /api/v1/sync/batch` | `POST /api/v1/events/{eventId}/sync/screening` (`syncScreeningBatch`). | Authenticated approved account; sync service validates event/station access, tracks client action IDs, and records outcomes. | Equivalent — the batch is explicitly event-scoped. |

## Required functional behavior

| School behavior | Actual OpenAPI/route evidence | Authorization or contract rule | Status |
| --- | --- | --- | --- |
| CRUD events; configure stations, schedules, and staff | Event create/read/PATCH/delete; station import/PATCH; membership and shift-assignment routes under `/api/v1/events/{eventId}`. | Create/delete are administrator-only; configuration requires event-manager authorization; deletes are terminal-state only. | Exact with safer lifecycle constraints. |
| Admin manage users, roles, events, stations, and staff assignment | `/api/v1/users`, `/api/v1/admin/accounts/*`, event membership/role/assignment routes. | User/admin routes require application administrator; event staffing requires event-manager authorization. | Exact. |
| Participant registration, update, search, unique ID | Participant CRUD/search, `/api/v1/events/{eventId}/registrations`, and database uniqueness constraints. | Registration officer permission and event scope; registration service owns duplicate/idempotency checks. | Exact, with PATCH instead of required PUT. |
| Queue status, transfer, station workload, completion tracking | `/api/v1/queues/events/{eventId}`, event-scoped queue-entry commands, and `/api/v1/queues/events/{eventId}/workload`. | Authenticated route/service checks with event scope; queue transitions are service-owned. | Exact. |
| Capture visual acuity, refraction, colour vision, and eye health | Event/station save routes exist for all four screening types. | Active station-duty authorization for screening saves. | Exact behavior, event-scoped. |
| Automatically flag results and require screener acknowledgement | Implemented visual-acuity/refraction/colour-vision services evaluate rules, return flags, and reject a flagged save without `acknowledged: true`. | Active screener duty; the acknowledgement is bound to the result write, not a separate endpoint. | Exact behavior, event-scoped. |
| Reviewer checks results/flags and creates referrals | `/api/v1/events/{eventId}/reviews*` and `/api/v1/events/{eventId}/referrals/{referralId}/issue`. | Reviewer event role and active duty; review/referral service checks. | Exact, event-scoped. |
| Dashboard for active event, queues, completion, sync health, outcomes/referrals | Active events, event metrics, operational report, queue status/workload, completed-event analytics, referral/review data, and event-scoped sync receipts. | Authenticated users are constrained by route/service event roles. | Equivalent — dashboard composes these resources; there is no single required “dashboard” API. |
| Screening/event/referral statistics | `/api/v1/events/reports/operations`, `/api/v1/events/{eventId}/metrics`, `/api/v1/events/{eventId}/analytics`, report export routes. | Event-manager authorization and reporting limiter. | Exact; exports are additional. |
| Offline save, retry, and idempotent sync | `OfflineSyncProvider` is wired in the React entry point; backend `syncScreeningBatch` stores idempotent sync action state and results. | Event/station access, action fingerprinting, and audit logging in `syncService`. | Exact server/client contract for screening sync; no deployment claim is made. |
| Versioned, authenticated APIs; role checks, validation, consistent errors, audit, idempotency on writes | `/api/v1` route mounting, OpenAPI problem responses, auth/authorization/validation middleware, service audit writes, idempotency middleware and service keys. | Depends on endpoint; browser cookie mutations also use CSRF protection. | Exact for implemented routes; individual routes document their security requirements in OpenAPI. |

## Contract deviations explained

### Cognito-managed login

The brief names `POST /auth/login`, but local code intentionally uses a Cognito hosted authorization-code flow. The browser begins at `/auth/authorize`; the callback verifies ID/access tokens, synchronizes the local account, and intersects provider group claims with locally assigned application roles. Cognito remains an external identity provider; PostgreSQL remains the application authorization and data store. The repository contains configuration and client code, not evidence that a Cognito user pool is deployed.

### PATCH rather than PUT

Events, participants, current accounts, users, stations, and queue entries use PATCH where the contract updates supplied fields or commands a partial state transition. This avoids pretending callers must replace complete resources and keeps optimistic concurrency/event-state guards meaningful. OpenAPI and Express routes both use PATCH; PUT is not advertised.

### Event-scoped screening and sync

Screening saves and sync batches include `{eventId}` and, where applicable, `{stationId}` in the path. This is stricter than the brief's flat routes: it gives authorization middleware and services a server-trusted scope before the write, prevents a token or registration from being used across events, and supports active-duty checks. The OpenAPI paths and mounted `screeningRoutes.js` use the same event-scoped forms.
