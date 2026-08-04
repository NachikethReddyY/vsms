## Sequence Diagram

The sequence diagram illustrates the interaction flow between users, system components, and backend services during the Visual Screening Management System (VSMS) workflow.

The process begins when a Registration Officer registers a participant through the React Progressive Web Application (PWA). The system validates and stores participant information either directly through the backend API when online or temporarily within IndexedDB when operating offline.

During screening, screeners retrieve participant information and record screening outcomes. The system performs validation and threshold checks before storing results. If network connectivity is unavailable, screening data is stored locally and synchronised once connectivity is restored.

After screening completion, reviewers access screening results, acknowledge flagged outcomes, and generate referrals when required. Finally, operational data is aggregated and displayed through the dashboard to provide real-time visibility of event progress, screening completion, and referral statistics.

This sequence demonstrates the VSMS requirements for offline-first operation, secure API communication, reliable synchronisation, role-based access control, and auditability.

<img width="1542" height="3210" alt="Sequence Diagram" src="https://github.com/user-attachments/assets/b5dc9dc9-71f6-46eb-aba1-5743a678e005" />

Diagram TXT file

```javascript
[Up@startuml
title VSMS Participant Screening Sequence Diagram

actor Participant
actor "Registration Officer" as RO
actor Screener
actor Reviewer

participant "Frontend\nReact PWA" as FE
participant "Local Storage\nIndexedDB" as Local
participant "Backend API\nNode.js + Express" as API
database "Database\nPostgreSQL/DynamoDB" as DB
participant "Sync Service" as Sync
participant "Dashboard" as Dash

== Participant Registration ==

RO -> FE: Enter participant details
FE -> FE: Validate input

alt Online Mode
    FE -> API: POST /api/v1/participants
    API -> DB: Store participant record
    DB --> API: Participant ID generated
    API --> FE: Registration successful
else Offline Mode
    FE -> Local: Store participant data locally
    Local --> FE: Saved pending sync
end

FE --> RO: Display participant ID


== Screening Process ==

Participant -> Screener: Proceed to screening station

Screener -> FE: Select participant

alt Online Mode
    FE -> API: Retrieve participant record
    API -> DB: Query participant
    DB --> API: Return participant data
    API --> FE: Display participant details
else Offline Mode
    FE -> Local: Retrieve cached participant data
    Local --> FE: Display participant details
end


Screener -> FE: Record screening results

FE -> FE: Apply threshold checks

alt Result requires attention
    FE -> FE: Create screening flag
end


alt Online Mode
    FE -> API: Submit screening result
    API -> DB: Save screening result
    DB --> API: Confirmation
    API --> FE: Result saved
else Offline Mode
    FE -> Local: Store result in sync queue
    Local --> FE: Pending synchronization
end


== Synchronization ==

FE -> Sync: Check pending records

Sync -> API: POST /api/v1/sync/batch

API -> DB: Insert pending records

DB --> API: Sync completed

API --> Sync: Success response

Sync --> FE: Update local status


== Review and Referral ==

Reviewer -> FE: Review screening results

FE -> API: Request screening records
API -> DB: Retrieve results
DB --> API: Return results
API --> FE: Display results

Reviewer -> FE: Acknowledge results

alt Referral required
    FE -> API: Create referral
    API -> DB: Store referral record
    DB --> API: Referral created
    API --> FE: Confirmation
end


== Dashboard Reporting ==

FE -> Dash: Request operational statistics

Dash -> API: GET dashboard data

API -> DB: Aggregate statistics

DB --> API: Return analytics data

API --> Dash: Display dashboard

@endumlloading Sequence Diagram.txt…]()

```
