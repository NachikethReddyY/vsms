# VSMS request and synchronization sequence

This sequence uses the current event-scoped API and the supported offline
station paths. Eye-health offline capture is intentionally absent.

```mermaid
sequenceDiagram
    actor Staff
    participant UI as React/Vite dashboard
    participant Local as Encrypted IndexedDB
    participant API as Express API
    participant Guard as Security, auth,<br/>authorization and validation middleware
    participant Route as Versioned route
    participant Controller
    participant Service as Domain service
    participant Prisma as Prisma Client
    participant Auth as Cognito
    participant DB as PostgreSQL
    participant Worker as Separate Node worker process

    Staff->>UI: Start sign-in
    UI->>API: GET /api/v1/auth/authorize
    API-->>UI: Redirect to Cognito
    UI->>Auth: Authorization-code + PKCE
    Auth-->>API: Callback code
    API->>Auth: Exchange code and validate identity
    API->>Guard: Context and callback checks
    Guard->>Route: Validated auth request
    Route->>Controller: Handle callback
    Controller->>Service: Synchronize local account
    Service->>Prisma: Load account and event access
    Prisma->>DB: Query/update local state
    DB-->>Prisma: Account and access
    Prisma-->>Service: Session state
    Service-->>Controller: Session result
    Controller-->>UI: Secure cookies and session summary

    Staff->>UI: Open assigned event/station
    UI->>API: GET stations and queue
    API->>Guard: Request context and authorization
    Guard->>Route: Validated request
    Route->>Controller: Map HTTP input
    Controller->>Service: Load assigned station context
    Service->>Prisma: Query scoped event data
    Prisma->>DB: SQL query
    DB-->>Prisma: Scoped event data
    Prisma-->>Service: Station context
    Service-->>Controller: Station snapshot
    Controller-->>UI: Station snapshot
    UI->>API: POST /events/{eventId}/sync/screening (actions: [])
    API->>Guard: Request context and authorization
    Guard->>Route: Validated sync request
    Route->>Controller: Handle sync pull
    Controller->>Service: Read current scoped queue and stations
    Service->>Prisma: Query snapshot
    Prisma->>DB: SQL query
    DB-->>Prisma: Snapshot rows
    Prisma-->>Service: Snapshot
    Service-->>Controller: Offline-pack source data
    Controller-->>UI: Encrypted offline-pack source data
    UI->>Local: Encrypt and store snapshot

    alt Online screening save
        Staff->>UI: Enter VA/refraction/colour result
        UI->>API: POST station result with idempotency key
        API->>Guard: Request context, auth, duty and validation
        Guard->>Route: Validated event/station request
        Route->>Controller: Map HTTP input
        Controller->>Service: Save result with actor/context
        Service->>Prisma: Evaluate and save transactionally
        Prisma->>DB: Screening, audit and outbox writes
        DB-->>Prisma: Screening result and audit/outbox rows
        Prisma-->>Service: Saved result and flag
        Service-->>Controller: Domain result
        Controller-->>UI: Saved result and flag
    else Offline screening save
        Staff->>UI: Enter supported station result
        UI->>Local: Encrypt mutation with clientActionId
        Local-->>UI: Pending sync status
    end

    Staff->>UI: Restore connectivity or tap sync
    UI->>API: POST /events/{eventId}/sync/screening (actions)
    API->>Guard: Request context, auth, duty and validation
    Guard->>Route: Validated event-scoped sync request
    Route->>Controller: Handle sync
    Controller->>Service: Claim action and reuse screening save service
    Service->>Prisma: Fingerprint, version and transaction
    Prisma->>DB: Claim and write action
    DB-->>Prisma: APPLIED, FAILED or CONFLICT
    Prisma-->>Service: Per-action outcome
    Service-->>Controller: Outcome and refreshed pull
    Controller-->>UI: Per-action status and refreshed pull
    UI->>Local: Remove applied record; retain conflict record

    Staff->>UI: Reviewer records decision/referral
    UI->>API: POST review decision / referral action
    API->>Guard: Request context, authorization and validation
    Guard->>Route: Validated event-scoped request
    Route->>Controller: Map HTTP input
    Controller->>Service: Authorize and transact decision
    Service->>Prisma: Write result and audit data
    Prisma->>DB: SQL transaction
    DB-->>Prisma: Review/referral status
    Prisma-->>Service: Domain result
    Service-->>Controller: Mapped result
    Controller-->>UI: Review/referral status

    Note over DB,Worker: Outbox and report/lifecycle jobs are claimed by standalone Node processes under backend/scripts/.
    DB-->>Worker: Claimable outbox or job row
    Worker->>Prisma: Process with service handlers
```

Evidence: `backend/routes/authRoutes.js`, `SynchronizationRoutes.js`,
`services/screening/syncService.js`, `services/screening/screeningService.js`,
and `react-user-dashboard/src/features/screening/offlineSync.ts`.
The normal online path is also recorded in `backend/docs/request-architecture.md`;
controllers map HTTP responses and services own Prisma transactions.
