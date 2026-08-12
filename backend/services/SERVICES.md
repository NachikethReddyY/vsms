# Backend services

Services are grouped by domain into subfolders. Each file is a plain Node
module (`require`) — services call each other directly via relative paths.
Cross-folder imports go up one level (e.g. `../event/eventAuthorizationService`).

## Where to find things

| Folder | Domain | Files |
| --- | --- | --- |
| `services/event/` | Event lifecycle, authorization, membership, venues | `eventService.js`, `eventAuthorizationService.js`, `eventMembershipService.js`, `attendanceDefinition.js`, `stationTemplateMapping.js`, `locationService.js` |
| `services/screening/` | Screening, review, referral, queue, offline sync | `screeningService.js`, `syncService.js`, `reviewService.js`, `referralService.js`, `queueService.js` |
| `services/participant/` | Participant registration, registration lifecycle, signature artifacts, and QR identity | `participantService.js`, `registrationService.js`, `signatureService.js`, `qrService.js` |
| `services/account/` | Accounts, auth, staff access, lifecycle ops, and administrator maintenance | `accountService.js`, `adminService.js`, `accountState.js`, `accountLifecycleNotificationService.js`, `accountProviderOperationService.js`, `userService.js`, `cognitoStaffAccessService.js`, `adminSafety.js` |
| `services/reporting/` | Reports, exports, analytics, artifact storage | `reportingService.js`, `reportExportService.js`, `reportRenderer.js`, `reportArtifactStorage.js`, `analyticsService.js` |
| `services/operations/` | Authorized multi-event operational snapshots | `operationsService.js` |
| `services/domain/` | Domain event bus (outbox) and its handlers | `domainEventBus.js`, `domainEventHandlers/` |
| `services/platform/` | Cross-cutting background jobs and provider events | `artifactCleanupService.js`, `sesProviderEventService.js`, `snsMessageService.js` |

## Per-service responsibilities

### `event/`
| File | Responsibility |
| --- | --- |
| `eventService.js` | Event CRUD, publish/start/complete/cancel transitions, station/shift/assignment management, artifact cleanup enqueue. The core aggregate service; emits `EVENT_TRANSITIONED`. |
| `eventAuthorizationService.js` | Visibility/permission predicates for event-scoped resources. |
| `eventMembershipService.js` | Membership/invitation flows for organisers and staff. |
| `attendanceDefinition.js` | Shared attendance status predicates/where clauses. |
| `stationTemplateMapping.js` | Maps station template keys to station types. |
| `locationService.js` | Venue/location data (OneMap integration). |

### `screening/`
| File | Responsibility |
| --- | --- |
| `screeningService.js` | Station screening flows (visual acuity, refraction, colour vision), idempotent result save, flag evaluation; emits `SCREENING_RESULT_RECORDED`. |
| `syncService.js` | Offline sync/backfill of screening station results. |
| `reviewService.js` | Review records, reviewer access, decision approvals. |
| `referralService.js` | Referral PDF generation, encryption, issuance, handoff recovery; emits `REFERRAL_ISSUED`. |
| `queueService.js` | Station queue lifecycle (handoff, call, check-in, complete). |

### `participant/`
| File | Responsibility |
| --- | --- |
| `participantService.js` | Participant registration and consent flows. |
| `registrationService.js` | Event registration lifecycle, event-duty checks, duplicate/idempotency handling, and registration history. |
| `signatureService.js` | Signature-target authorization and signature-artifact persistence. |
| `qrService.js` | QR token issue/rotation, event-scoped QR authorization, and registration resolution. |

### `account/`
| File | Responsibility |
| --- | --- |
| `accountService.js` | User accounts, Cognito-to-local account synchronization, approval lifecycle, provider operation dispatch. |
| `adminService.js` | Administrator audit-log reads and maintenance-operation orchestration. |
| `accountState.js` | Account state enums/derived status. |
| `accountLifecycleNotificationService.js` | Account lifecycle event notifications. |
| `accountProviderOperationService.js` | Provider (Cognito) operation ordering/retry. |
| `userService.js` | User profile management. |
| `cognitoStaffAccessService.js` | Cognito staff access and invite flows. |
| `adminSafety.js` | Admin safety guards for destructive operations. |

### `reporting/`
| File | Responsibility |
| --- | --- |
| `reportingService.js` | Report request lifecycle and status. |
| `reportExportService.js` | Report export/rendering pipeline (claim/lease worker). |
| `reportRenderer.js` | Report content rendering. |
| `reportArtifactStorage.js` | Report artifact staging/publish/cleanup (blob storage). |
| `analyticsService.js` | Analytics queries/exports. |

### `operations/`
| File | Responsibility |
| --- | --- |
| `operationsService.js` | Aggregate-only multi-event queue, progress, station, staffing, referral, and sync health for administrators and assigned event managers. |

### `domain/`
| File | Responsibility |
| --- | --- |
| `domainEventBus.js` | Transactional outbox + handler registry used inside the separate Node worker process. Producers call `emit()` in the same transaction; the worker claims and dispatches with retry/backoff/dead-letter. |
| `domainEventHandlers/index.js` | Handlers subscribed by event type (e.g. `SCREENING_FLAGGED` fan-out, audit observers). |

### `platform/`
| File | Responsibility |
| --- | --- |
| `artifactCleanupService.js` | Background artifact cleanup queue and processor. |
| `sesProviderEventService.js` | SES provider event ingestion (delivery/bounce). |
| `snsMessageService.js` | SNS notification outbound handling. |

## Conventions
- Controllers do not query Prisma. They validate/map HTTP input and responses; services own Prisma reads, writes, and transaction boundaries.
- Prisma is the data-access boundary for PostgreSQL. Do not add a repository layer unless a second persistence implementation creates a concrete need.
- One aggregate/flow per service file; keep files under ~800 lines where possible
  (split helpers into a sibling module if it grows).
- Emit domain events via `domainEventBus.emit({ client: tx, type, aggregateType, aggregateId, correlationId, actorUserId, payload })` **inside** the same `prisma.$transaction` that mutates state.
- Handlers live in `services/domain/domainEventHandlers/` and must be idempotent (at-least-once delivery).
- New services must be added to this index.
