# VSMS request and synchronization sequence

This sequence uses the current event-scoped API and the supported offline
station paths. Eye-health offline capture is intentionally absent.

```mermaid
sequenceDiagram
    actor Staff
    participant UI as React/Vite dashboard
    participant Local as Encrypted IndexedDB
    participant API as Express API
    participant Auth as Cognito
    participant DB as PostgreSQL

    Staff->>UI: Start sign-in
    UI->>API: GET /api/v1/auth/authorize
    API-->>UI: Redirect to Cognito
    UI->>Auth: Authorization-code + PKCE
    Auth-->>API: Callback code
    API->>Auth: Exchange code and validate identity
    API->>DB: Load local account and event access
    API-->>UI: Secure cookies and session summary

    Staff->>UI: Open assigned event/station
    UI->>API: GET stations and queue
    API->>DB: Query assigned station context
    DB-->>API: Scoped event data
    API-->>UI: Station snapshot
    UI->>API: POST /events/{eventId}/sync/screening (actions: [])
    API->>DB: Read current scoped queue and stations
    API-->>UI: Encrypted offline-pack source data
    UI->>Local: Encrypt and store snapshot

    alt Online screening save
        Staff->>UI: Enter VA/refraction/colour result
        UI->>API: POST station result with idempotency key
        API->>DB: Validate, authorize, evaluate and save transactionally
        DB-->>API: Screening result and audit/outbox rows
        API-->>UI: Saved result and flag
    else Offline screening save
        Staff->>UI: Enter supported station result
        UI->>Local: Encrypt mutation with clientActionId
        Local-->>UI: Pending sync status
    end

    Staff->>UI: Restore connectivity or tap sync
    UI->>API: POST /events/{eventId}/sync/screening (actions)
    API->>DB: Claim sync action with fingerprint/version
    API->>DB: Reuse screening save service
    DB-->>API: APPLIED, FAILED or CONFLICT
    API-->>UI: Per-action status and refreshed pull
    UI->>Local: Remove applied record; retain conflict record

    Staff->>UI: Reviewer records decision/referral
    UI->>API: POST review decision / referral action
    API->>DB: Authorize, transact and append audit data
    API-->>UI: Review/referral status
```

Evidence: `backend/routes/authRoutes.js`, `SynchronizationRoutes.js`,
`services/screening/syncService.js`, `services/screening/screeningService.js`,
and `react-user-dashboard/src/features/screening/offlineSync.ts`.
