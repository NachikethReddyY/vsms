# VSMS use-case diagram

The use cases are limited to paths represented in the current OpenAPI contract
and frontend route structure.

```mermaid
flowchart LR
    admin[Administrator]
    manager[Event manager]
    registration[Registration officer]
    screener[Screener]
    reviewer[Reviewer]

    subgraph vsms[VSMS]
        account((Manage accounts and access))
        event((Create and operate events))
        participant((Register and update participants))
        queue((Manage station queues))
        screening((Record screening results and flags))
        offline((Save and synchronize supported offline results))
        review((Review results and issue referrals))
        report((View metrics and export aggregate reports))
        audit((Audit sensitive actions))
    end

    admin --> account
    admin --> event
    admin --> report
    manager --> event
    manager --> queue
    manager --> report
    registration --> participant
    registration --> queue
    screener --> queue
    screener --> screening
    screener --> offline
    reviewer --> review
    account -.-> audit
    event -.-> audit
    participant -.-> audit
    queue -.-> audit
    screening -.-> audit
    review -.-> audit
```

The diagram does not imply that every role can access every event. Event
membership, role and active duty checks are enforced by the backend.
