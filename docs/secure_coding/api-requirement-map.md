# VSMS API requirement map

This is the inclusion point for the API requirement mapping in the report.
The operation names and paths below are taken from
[`backend/docs/openapi.yaml`](../../backend/docs/openapi.yaml); the source
links identify the current route/controller/service evidence. The status is a
repository status, not a live endpoint result.

The inclusion path is **versioned route and middleware → controller → service
→ Prisma Client → PostgreSQL**. The controller maps HTTP input/output; the
service owns domain decisions, authorization-sensitive checks, transactions
and Prisma access. The detailed `backend/docs/request-architecture.md` and
`docs/api-contract-mapping.md` files record the same current boundary.

## Core requirements

| Requirement | API operations | Implementation evidence | Status |
| --- | --- | --- | --- |
| FR-01 Event management | `listEvents`, `createEvent`, `getEvent`, `updateEvent`, `deleteTerminalEvent`, `publishEvent`, `startEvent`, `completeEvent`, `cancelEvent` | [`eventRoutes.js`](../../backend/routes/eventRoutes.js), [`eventController.js`](../../backend/controllers/eventController.js), [`eventService.js`](../../backend/services/event/eventService.js) | Implemented |
| FR-02 Account and access management | `authorizeWithCognito`, `completeCognitoAuthorization`, `refreshSession`, `logout`, `globalLogout`, `getCurrentUser`, `listAccounts`, `approveAccount`, `suspendAccount`, `reactivateAccount`, `deprovisionAccount` | [`authRoutes.js`](../../backend/routes/authRoutes.js), [`adminRoutes.js`](../../backend/routes/adminRoutes.js), account services, [`cognitoClient.js`](../../backend/utils/cognitoClient.js) | Implemented; provider configuration-dependent |
| FR-03 Participant registration | `searchParticipants`, `createParticipant`, `updateParticipant`, `createRegistration`, `changeRegistrationStatus`, consent and emergency-contact operations | [`participantRoutes.js`](../../backend/routes/participantRoutes.js), [`registrationRoutes.js`](../../backend/routes/registrationRoutes.js), participant/registration services | Implemented |
| FR-04 Queue management | `getEventQueueStatus`, `listRegistrationStations`, `createQueueHandoff`, `joinQueue`, `callQueueEntry`, `startQueueEntry`, `advanceQueueEntry`, `completeQueueEntry`, `skipQueueEntry`, `updateQueueEntryPriority` | [`queueRoutes.js`](../../backend/routes/queueRoutes.js), [`queueService.js`](../../backend/services/screening/queueService.js) | Implemented |
| FR-05 Screening results and flags | `listScreeningStations`, `listScreeningQueue`, `resolveScreeningParticipant`, `previewVisualAcuity`, `saveVisualAcuity`, `previewRefraction`, `saveRefraction`, `previewColourVision`, `saveColourVision` | [`screeningRoutes.js`](../../backend/routes/screeningRoutes.js), [`screeningController.js`](../../backend/controllers/screeningController.js), [`screeningService.js`](../../backend/services/screening/screeningService.js) | Implemented for three station types; eye-health deferred |
| FR-06 Review and referral | `listClinicalReviews`, `getClinicalReview`, `recordClinicalReviewDecision`, `issueReferral`, `reviseReferral`, `acknowledgeReferralHandoff`, `downloadReferralDocument` | [`reviewService.js`](../../backend/services/screening/reviewService.js), [`referralService.js`](../../backend/services/screening/referralService.js), review/referral routes | Implemented |
| FR-07 Dashboard and reporting | `getEventMetrics`, `getCompletedEventAnalytics`, `getOperationalReport`, report-export job and download operations | [`reportingController.js`](../../backend/controllers/reportingController.js), [`analyticsService.js`](../../backend/services/reporting/analyticsService.js), reporting routes | Implemented as source paths; no measured production result claimed |
| NFR-OFFLINE | `syncScreeningBatch` at `POST /api/v1/events/{eventId}/sync/screening` | [`SynchronizationRoutes.js`](../../backend/routes/SynchronizationRoutes.js), [`syncService.js`](../../backend/services/screening/syncService.js), [`offlineSync.ts`](../../react-user-dashboard/src/features/screening/offlineSync.ts) | Implemented for scoped VA/refraction/colour-vision flow |

## Cross-cutting request controls

| Control | Evidence | Applies to |
| --- | --- | --- |
| Authentication/session | `authenticate`, `requireAuthentication`, Cognito callback/refresh and secure cookies | Protected operations |
| Event authorization | `requireEventAuthorization`, `requireEventRoleAndDuty`, event membership services | Event, queue, screening, review and report operations |
| Input validation | [`backend/schemas/`](../../backend/schemas/), `middlewares/validate.js` | Request bodies and query/path inputs |
| Idempotency | `middlewares/idempotency.js`, screening request ledger, sync `clientActionId` | Event, registration, screening and sync writes |
| Auditability | `utils/audit.js`, `AuditLog`, `AuthAuditLog`, `EventAuditLog`, immutable migration triggers | Security-sensitive mutations and decisions |
| Contract check | [`backend/scripts/check-contract.js`](../../backend/scripts/check-contract.js) and OpenAPI lint script | OpenAPI/generated client alignment |

## Deliberate non-mappings

The older project brief lists illustrative `/auth/login`, `/auth/logout`,
station-specific `/screenings/*`, and `/sync/batch` paths. They are not
current paths and are not used in this map. The current implementation uses
Cognito authorization routes, event-scoped screening routes, and the single
event-scoped sync batch route shown above.

The brief also presents multiple persistence and hosting alternatives. This
map records only the current Express/Prisma/PostgreSQL route contract; it does
not turn an alternative into an implemented service.
