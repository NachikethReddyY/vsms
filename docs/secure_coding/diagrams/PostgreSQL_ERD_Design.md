# PostgreSQL relational design

The Prisma schema and migrations are the canonical database design. This
focused ERD shows the records used by the event, screening and offline paths;
it is not a complete rendering of every supporting model.

```mermaid
erDiagram
    USER ||--o{ EVENT : creates
    USER ||--o{ EVENT_MEMBERSHIP : holds
    EVENT ||--o{ EVENT_MEMBERSHIP : grants
    EVENT_MEMBERSHIP ||--o{ EVENT_MEMBERSHIP_ROLE : has
    USER ||--o{ PARTICIPANT : creates
    EVENT ||--o{ EVENT_REGISTRATION : contains
    PARTICIPANT ||--o{ EVENT_REGISTRATION : joins
    EVENT ||--o{ STATION : defines
    STATION ||--o{ QUEUE_ENTRY : serves
    EVENT_REGISTRATION ||--o{ QUEUE_ENTRY : enters
    USER ||--o{ SCREENING_RESULT : records
    STATION ||--o{ SCREENING_RESULT : receives
    EVENT_REGISTRATION ||--o{ SCREENING_RESULT : has
    EVENT_REGISTRATION ||--o{ REVIEW : receives
    REVIEW ||--o{ REFERRAL : may_create
    USER ||--o{ AUDIT_LOG : performs
    USER ||--o{ SYNC_ACTION : submits
    EVENT ||--o{ SYNC_ACTION : scopes
    SYNC_ACTION ||--o{ SYNC_ACTION_TRANSITION : records

    USER {
        uuid user_id PK
        string email UK
        enum system_role
        enum access_state
    }
    EVENT {
        uuid event_id PK
        string name
        enum status
        int version
    }
    EVENT_REGISTRATION {
        uuid registration_id PK
        uuid event_id FK
        uuid participant_id FK
        enum registration_status
        string idempotency_key
    }
    STATION {
        uuid station_id PK
        uuid event_id FK
        enum station_type
        boolean is_active
    }
    QUEUE_ENTRY {
        uuid queue_id PK
        uuid registration_id FK
        uuid station_id FK
        enum status
    }
    SCREENING_RESULT {
        uuid result_id PK
        uuid registration_id FK
        uuid station_id FK
        enum overall_flag
        string rule_version
    }
    SYNC_ACTION {
        uuid sync_action_id PK
        uuid client_action_id UK
        enum status
        string entity_type
    }
    SYNC_ACTION_TRANSITION {
        uuid sync_transition_id PK
        uuid sync_action_id FK
        int sequence
        enum status
    }
```

The full model is in `backend/prisma/schema.prisma`. The standalone
`backend/stored_procedures.sql` file is documented separately because its
legacy table names do not establish that those procedures are installed in
the current Prisma schema.
