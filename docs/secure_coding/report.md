---
title: ST2515 Secure Coding Project Report (CA2)
authors:
  - Nachiketh Reddy Y (A01, A09)
  - Mike Franco Abat (A03)
  - Sitt Naing (A04)
  - Keefe Chen Lin Li (A07, A02)
module: ST2515 Secure Coding
date: June 2026
submission: 29 June 2026
---

# Visual Screening Management System (VSMS) — Secure Coding Project Report

# 1. Executive Summary & Problem Statement

## 1.1 Executive Summary

The Visual Screening Management System (VSMS) is a secure web-based application designed to improve the efficiency, reliability, and security of community vision screening operations. The system digitises traditional paper-based screening workflows by providing secure participant registration, QR-based participant verification, station-based screening processes, queue management, and administrative monitoring.

VSMS adopts a security-first design approach based on the principles of **defence-in-depth**, **least privilege**, and **secure data handling**. Sensitive participant information is protected through authentication controls, role-based authorization, input validation, secure database access patterns, encrypted communication channels, and comprehensive audit tracking.

The system is designed to support real-world screening environments where multiple staff members operate different screening stations while maintaining confidentiality, integrity, and availability of participant records.

---

## 1.2 Problem Statement

Traditional community health screening events frequently rely on manual registration forms or spreadsheet-based tracking systems. These approaches introduce several operational and security challenges:

- Increased risk of unauthorised access to sensitive participant information such as personal details and screening records.
- Difficulty maintaining accurate participant queues across multiple screening stations.
- Lack of real-time visibility into screening progress and participant movement.
- Higher possibility of duplicate records, human errors, and inconsistent data updates.
- Limited accountability due to insufficient tracking of user actions.

VSMS addresses these issues by providing a centralised and secure platform that enables controlled access, automated workflow management, and reliable data processing.

---

## 1.3 Business Requirements

### Secure Participant Registration
The system provides a validated participant registration workflow that ensures accurate collection and storage of demographic information. Server-side validation prevents malformed or malicious input from reaching the database.

### Secure QR-Based Verification
QR codes are implemented using cryptographically generated tokens rather than storing sensitive participant information directly inside the QR payload.

The QR token acts only as a secure reference identifier, allowing authorised backend services to retrieve participant information while preventing exposure of personal data if the QR code is intercepted.

### Role-Based Operational Access Control
VSMS implements Role-Based Access Control (RBAC) to enforce separation of responsibilities between different user groups:

- Administrators: Manage users, permissions, and system configurations.
- Registration Officers: Handle participant onboarding and queue management.
- Screening Staff: Access assigned screening workflows and record screening results.

Authorisation checks are enforced at the backend to prevent privilege escalation and unauthorised API access.

### Auditability and Accountability
The system maintains audit records for important security-sensitive operations, including authentication activities, administrative actions, QR verification events, and screening updates.

These records support accountability, troubleshooting, and security monitoring.

---

# 2. Requirements Analysis

## 2.1 Design Process & Workflow Mapping

To ensure the Visual Screening Management System (VSMS) accurately reflects ground operations, the system architecture was developed using a bottom-up design methodology. 

Initial physical station layouts, participant paths, and data flows were mapped using conceptual system sketches. These visual journeys were then translated into core User Stories, which directly formed the functional requirements and technical implementation specs.

### 2.1.1 Sketch-to-Workflow Analysis
<img width="2048" height="1536" alt="image" src="https://github.com/user-attachments/assets/cb2f5513-7e67-47c4-b63e-6fce677ed5d2" />

Based on operational site sketches, the participant flow is structured as follows:

1. **Entry & Registration:** Participants arrive at the entrance flag/station and undergo manual registration. 
2. **QR Pass Generation:** A unique QR token (`a/b` / `pass ID`) is created for the participant to track them across stations without exposing personal health data.
3. **Multi-Station Screening Routing:** Participants move sequentially through screening stations (e.g., `S1`, `S2`, `S3` for Visual Acuity, Refraction, and Color Vision). Station screeners scan the participant pass to retrieve existing details.
4. **Auto-Flagging & Clinical Review:** Test inputs are evaluated against clinical thresholds. Flagged cases are automatically highlighted for the doctor/reviewer room.
5. **Completion & Exit:** Once the doctor conducts the final review/referral, the participant is cleared to exit the event.

---

### 2.1.2 Actor Mapping & User Story Generation

To bridge the visual site sketches with functional system design, **Excalidraw** was used to model the system boundaries, map actor roles to specific station responsibilities, and map the end-to-end user journeys. 

By visualizing how each actor (Registration Officer, Screener, Reviewer/Doctor, Event Manager) interacts with both the physical workflow and the digital interface, we derived the following core User Stories:

<img width="709" height="296" alt="image" src="https://github.com/user-attachments/assets/edb2350f-48a3-4874-9621-b9834c396814" />

**Link**: https://excalidraw.com/#json=u0RGhPVcWgBYPCeDk3LIJ,YWMsVuLyWe2ryJA440ZZTQ

#### User Stories

* **US-01 (Registration Officer):** *As a Registration Officer, I want to manually enter participant details and generate a non-sensitive QR pass so that participants can move safely through stations without exposing PII.*
* **US-02 (Screener):** *As a Screener at Station S1/S2/S3, I want to scan a participant's QR pass to fetch their profile and enter screening measurements even when internet connectivity is unstable.*
* **US-03 (Reviewer / Doctor):** *As a Reviewing Doctor, I want the system to automatically flag abnormal clinical results (e.g., 2-line eye asymmetry, high astigmatism) so I can make quick referral decisions.*
* **US-04 (Event Manager):** *As an Event Manager, I want real-time visibility into station queues and participant progress across the entire screening floor.*

## 2.2 Functional Requirements

### 2.2.1 Authentication and Session Management
* Secure user authentication using JWT-based authentication.
* Passwords are securely hashed using `bcrypt` before storage.
* Refresh token and session management are implemented to reduce risks associated with long-lived access tokens.
* Authentication endpoints enforce strong password requirements validated via `Zod` schemas.

### 2.2.2 Participant & Event Management
* Staff can register and manage participant records electronically (FR-01, FR-02, FR-03).
* Duplicate participant creation is prevented through unique database constraints (e.g., NRIC/ID indexes).
* Participant data retrieval is restricted according to user roles (Role-Based Access Control).

### 2.2.3 QR Verification Workflow
* System generates unique QR tokens using cryptographically secure random generation.
* QR codes contain token references only and do not expose participant PII.
* Tokens can be validated, expired, revoked, and tracked through `QRCodePass` records.

### 2.2.4 Queue and Screening Workflow
* Participants are assigned queue positions during screening events.
* Staff can update participant progress across different stations (`S1`, `S2`, `S3`, `Doctor Room`).
* Station screeners record results electronically with automated clinical threshold flagging (Visual Acuity, Refraction, Color Vision).
* Queue states are synchronized in real-time between registration and screening workflows.

### 2.2.5 Offline Capability & Synchronization
* Designed as a Progressive Web Application (PWA) with client-side storage (`IndexedDB`) to support offline network environments.
* Supports manual sync, continuous sync, automatic retry with exponential backoff, and idempotent backend ingestion to avoid duplicate records.

---

## 2.3 Non-Functional Requirements (NFRs)

While Functional Requirements specify *what* the system does, Non-Functional Requirements define *how well* the system performs under field conditions, network instabilities, and operational constraints during community screening events.

### 2.3.1 Performance and Scalability
* **NFR-PERF-01 (API Response Latency):** All backend API endpoints (e.g., participant lookups, token verification, queue updates) must maintain a response latency of $\le 1.0\text{ second}$ under normal operational load.
* **NFR-PERF-02 (Database Optimization):** Database query execution is optimized using Prisma ORM with target indexing on frequently queried fields (e.g., `participantId`, `qrToken`, `queueStatus`).
* **NFR-PERF-03 (System Capacity):** The system must support concurrent screening workflows for up to **500 participants per event** with a minimum of **20 simultaneous active screeners** without performance degradation.

### 2.3.2 Availability, Reliability, and Offline Resilience
* **NFR-REL-01 (High Availability):** Cloud backend services must maintain **99.9% availability** during scheduled screening events.
* **NFR-REL-02 (Offline Continuity):** The application is designed as a Progressive Web Application (PWA) using `IndexedDB` for client-side storage, allowing screeners to view screens, navigate, and capture test results without active network connectivity.
* **NFR-REL-03 (Idempotent Sync Engine):** Offline operations synced upon network restoration must include an `Idempotency-Key` header. Duplicate network requests must resolve safely without creating duplicate participant records or duplicate screening entries.
* **NFR-REL-04 (Sync Lifecycle & Auto-Retry):** Background sync requests must transition through a defined status lifecycle (`PENDING` $\rightarrow$ `PROCESSING` $\rightarrow$ `SUCCESS` / `FAILED` $\rightarrow$ `RETRY`) using exponential backoff to handle transient network dropped states automatically.
* **NFR-REL-05 (ACID Database Integrity):** PostgreSQL transactions enforce strict data consistency during concurrent operations (e.g., atomic registration, queue transitions, and result submissions).

### 2.3.3 Security Controls and OWASP Alignment
The Visual Screening Management System (VSMS) incorporates a defense-in-depth security approach aligned with the **OWASP Top 10 (2021)** framework across all application layers.

| OWASP Category | Technical Control & Architecture Implementation |
| :--- | :--- |
| **A01: Broken Access Control** | Backend Role-Based Access Control (RBAC) middleware enforces fine-grained route protection based on user roles (*Admin, Event Manager, Registration Officer, Screener, Reviewer*). |
| **A02: Cryptographic Failures** | HTTPS/TLS encryption in transit; passwords hashed using `bcrypt` (salt factor $\ge 10$); non-sensitive cryptographically generated tokens (`a/b` reference IDs) used for QR codes. |
| **A03: Injection** | Prisma ORM parameterizes all database queries; strict request payload validation on both frontend and backend using `Zod` schemas. |
| **A04: Insecure Design** | Explicit threat modeling performed during design phase; strict decoupling of participant PII from physical QR codes; offline sync security boundaries. |
| **A05: Security Misconfiguration** | Strict CORS allow-listing; Helmet middleware enforcing Content Security Policy (CSP); Express header fingerprinting disabled (`x-powered-by`); environment-based configs. |
| **A06: Vulnerable Components** | Continuous software supply-chain auditing using automated dependency scanning (`npm audit`) to identify and remediate known Common Vulnerabilities and Exposures (CVEs). |
| **A07: Identification & Auth** | JWT authentication with short-lived access tokens and secure refresh token session management; rate limiting applied via middleware on authentication endpoints to prevent brute-forcing. |
| **A08: Software & Data Integrity** | Application of idempotency keys to prevent duplicate transaction state changes; CI/CD pipeline enforcement requiring lockfile verification and immutable build artifact hashing before release. |
| **A09: Logging & Monitoring** | Structured security audit logging (`Winston` logger) capturing authentication attempts, administrative changes, QR verification attempts, and clinical override flags. |
| **A10: SSRF** | Restricting backend outbound HTTP requests via strict domain allow-listing. |

---

## 2.4 Use Case Analysis

### 2.4.1 Participant Check-In and Multi-Station Screening Journey

* **Primary Actors:** Registration Officer, Screener (Stations S1-S3), Reviewer / Doctor, Participant.
* **Preconditions:** 1. An active event has been created by the Event Manager.
  2. Registration staff and Screeners are authenticated into their respective station roles.

#### Main Success Scenario

1. **Registration & QR Pass Generation:**
   * Participant arrives at the registration flag/desk.
   * Registration Officer enters participant details.
   * The system checks database constraints to prevent duplicate creation.
   * System generates a cryptographically secure, non-sensitive `QRCodePass` token reference (containing zero participant PII) and links it to the participant record.

2. **Station Routing and Progress Tracking:**
   * Participant advances to assigned screening stations (`S1: Visual Acuity`, `S2: Refraction`, `S3: Color Vision`).
   * Screener scans the participant's QR code.
   * Backend/PWA validates the token, fetches current queue status, and loads the participant's screening form.

3. **Data Recording & Auto-Flagging:**
   * Screener conducts the test and submits clinical measurements.
   * The system automatically evaluates entries against clinical thresholds (e.g., Visual Acuity $\ge 2$-line asymmetry, high astigmatism $\text{CYL} > -3.00\text{ D}$, single-eye color deficiency).
   * Flagged results are automatically highlighted and queued for clinical review.

4. **Doctor Review & Clearance:**
   * The Reviewing Doctor scans the participant pass or opens the flagged queue.
   * Doctor reviews highlighted anomalies, acknowledges auto-flagged warnings, adds clinical notes, generates referral forms if necessary, and marks the participant journey as complete.

#### Exception & Alternative Flows

* **E-1: Network Connection Lost (Offline Mode):**
  * *Condition:* Internet drops during screening entry.
  * *System Action:* PWA stores test records in local `IndexedDB` with a `PENDING` sync status. Screener continues workflow uninterrupted. When connection restores, background sync uploads pending data using idempotency keys.
* **E-2: Duplicate Registration Attempt:**
  * *Condition:* Staff attempts to register a participant who already exists in the current event.
  * *System Action:* Unique database constraints trigger a validation error. System prompts staff to retrieve the existing participant profile and re-issue the QR pass if lost.
* **E-3: Invalid / Expired QR Token:**
  * *Condition:* Scanned QR token is invalid, revoked, or assigned to a different event.
  * *System Action:* Backend returns an authorization error message. Queue state remains unchanged, and station screener is prompted to re-verify participant identity.

---

## 2.5 Requirements Traceability Matrix (RTM)

| Req ID | User Story / Source | Requirement Description | Target Role | Priority | Implementation Component |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-AUTH-01** | System Core | JWT Authentication & Session Refresh | All Users | **High** | `AuthService`, Refresh Tokens |
| **REQ-AUTH-02** | System Core | Password Hashing & Zod Schema Validation | Admin | **High** | `bcrypt`, Zod Validation Middleware |
| **REQ-REG-01** | Sketch / US-01 | Electronic Participant Registration & Profiling | Reg Officer | **High** | `ParticipantModule`, Database Indexing |
| **REQ-QR-01** | Sketch / US-01 | Cryptographic Non-PII QR Token Pass Generation | Reg Officer | **High** | Crypto Engine, `QRCodePass` Entity |
| **REQ-QUE-01** | Sketch / US-02 | Station Queue Assignment & Progress Tracking | Screener | **High** | Queue Management Controller |
| **REQ-SCR-01** | Appendix / US-03 | Automated Clinical Flagging Thresholds | Screener / Doctor | **High** | Screening Assessment Engine |
| **REQ-REV-01** | Sketch / US-03 | Final Outcome Review & Referral Generation | Doctor / Reviewer | **High** | `ReviewerModule` |
| **NFR-PERF-01** | Performance | API Response Latency $\le 1.0\text{s}$ | All Users | **High** | Prisma Indexing, Fastify/Express Routers |
| **NFR-REL-02** | Section 9 / US-02 | Client-side Storage & PWA Support | Field Staff | **High** | Service Worker, `IndexedDB` |
| **NFR-REL-03** | Section 9 / Idempotency| Idempotent Background Synchronization & Retries | System | **High** | Idempotency Sync Engine, Queue Retry Worker |
| **NFR-SEC-01** | OWASP A01-A10 | Defense-in-depth Security Controls | All Users | **High** | Helmet, Zod, RBAC Middleware |

# 3. Architecture Design

## 3.1 Application Architecture Overview

VSMS follows a layered web application architecture consisting of:

- React-based Progressive Web Application frontend.
- Express.js backend API layer.
- Prisma ORM data access layer.
- PostgreSQL relational database.

The separation between frontend and backend ensures that security-sensitive operations, including authentication, authorisation, validation, and database access, remain controlled by the server.

---

## 3.2 Client Application & Offline Layer Design

The frontend is implemented as a Progressive Web Application (PWA) to support deployment in environments with unreliable network connectivity.

Key design considerations:

- Responsive interface for different screening devices.
- Local caching through service worker technology.
- Offline workflow support.
- Synchronisation mechanisms for pending updates.

The offline-first approach ensures screening operations can continue temporarily without complete dependence on network availability.

---

## 3.3 API and Integration Layer Architecture

The backend exposes secured RESTful APIs responsible for:

- Authentication.
- Participant management.
- QR generation and verification.
- Queue management.
- Screening result submission.
- Administrative operations.

API requests pass through security middleware responsible for:

- Authentication verification.
- Role validation.
- Input sanitisation.
- Error handling.

---

# 4. Database & ORM Architecture Design

## 4.1 PostgreSQL and Prisma ORM Integration

VSMS uses PostgreSQL as its relational database management system due to its:

- Strong ACID transaction guarantees.
- Referential integrity enforcement.
- Support for complex relationships.
- Reliable handling of concurrent operations.

Prisma ORM acts as the database abstraction layer between the Express backend and PostgreSQL.

Advantages of Prisma integration include:

- Type-safe database queries.
- Automatic schema migration management.
- Reduced risk of SQL injection through parameterised queries.
- Clear relationship modelling between entities.

The Prisma schema defines all database structures including:

- User management.
- Authentication credentials.
- Roles and permissions.
- Participants.
- Events.
- Screening stations.
- Queue entries.
- QR verification tokens.
- Screening results.
- Audit logs.

---

## 4.2 Entity Relationship & Access Patterns

The VSMS database follows a relational design with enforced relationships between core entities.

Examples:

- Users are associated with roles through role mappings.
- Participants are linked to screening events.
- Screening results are connected to individual participants and stations.
- QRCodePass records maintain secure token references for participant verification.
- Audit logs record security-sensitive operations.

Database optimisation is achieved through:

- Primary keys for entity identification.
- Foreign keys for referential integrity.
- Indexes on frequently queried fields such as QR tokens, user identifiers, and participant records.

This structure enables efficient participant lookup, secure access control, and reliable screening workflow management.
---

# 5. API Design

## 5.1 Secure Core API Specification

The VSMS backend exposes RESTful APIs secured using JWT authentication and role-based authorization. All protected endpoints require authentication middleware before business logic is executed.

| Endpoint | Method | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `/api/v1/auth/login` | POST | Public | Authenticate staff and issue JWT tokens. |
| `/api/v1/auth/refresh` | POST | Authenticated | Refresh access tokens using refresh sessions. |
| `/api/v1/auth/logout` | POST | Authenticated | Invalidate the current session. |
| `/api/v1/participants` | GET | Admin / Officer | Retrieve participant records. |
| `/api/v1/participants` | POST | Admin / Officer | Register a new participant. |
| `/api/v1/events` | GET | Authenticated | Retrieve available events. |
| `/api/v1/events` | POST | Admin | Create new events. |
| `/api/v1/qr/generate/:registrationId` | POST | Authenticated | Generate participant QR codes. |
| `/api/v1/screening/:eventId/stations` | GET | Authenticated | Retrieve screening stations. |
| `/api/v1/screening/:eventId/stations/:stationId/queue` | GET | Authenticated | Retrieve station queue. |
| `/api/v1/screening/:eventId/registrations/resolve` | GET | Authenticated | Resolve participant registration from QR code or registration information. |
| `/api/v1/screening/:eventId/stations/:stationId/visual-acuity` | POST | Authenticated | Create or update visual acuity screening results. |

---

## 5.2 Request Validation & Transaction Processing

Every incoming request is validated before reaching the controller layer.

Validation includes:

- Required field validation.
- Data type validation.
- Length restrictions.
- Enumeration validation.
- Business rule validation.

Zod validation schemas reject malformed requests before they reach the database.

Critical operations such as participant registration and screening result creation execute within database transactions where necessary to maintain data consistency.

The application architecture follows the request flow below:

```
Client Request
      │
      ▼
Authentication Middleware
      │
      ▼
Authorization Middleware
      │
      ▼
Request Validation (Zod)
      │
      ▼
Controller
      │
      ▼
Service Layer
      │
      ▼
Prisma ORM
      │
      ▼
PostgreSQL
```

---

## 5.3 Standard HTTP Responses

The application returns standardized JSON responses for both successful and failed requests.

Example validation response:

```json
{
  "success": false,
  "message": "Request validation failed",
  "errors": [
    {
      "field": "nric",
      "message": "Invalid NRIC format."
    }
  ]
}
```

Common HTTP status codes include:

| Status Code | Description |
| :--- | :--- |
| **200 OK** | Request completed successfully. |
| **201 Created** | Resource created successfully. |
| **400 Bad Request** | Invalid request payload. |
| **401 Unauthorized** | Authentication required or token expired. |
| **403 Forbidden** | Insufficient permissions. |
| **404 Not Found** | Requested resource not found. |
| **409 Conflict** | Duplicate or conflicting resource. |
| **422 Unprocessable Entity** | Validation failed. |
| **429 Too Many Requests** | Rate limit exceeded. |
| **500 Internal Server Error** | Unexpected server error. |

---

# 6. Security Design

## 6.1 OWASP Top 10 Mitigation Controls

VSMS adopts a defense-in-depth security strategy by combining secure authentication, authorization, request validation, secure database access, HTTPS communication, and centralized logging.

| OWASP Threat | Security Risk | Implemented Mitigation |
| :--- | :--- | :--- |
| **A01 Broken Access Control** | Unauthorized users accessing protected resources. | JWT authentication middleware together with Role-Based Access Control (RBAC) ensures users can only access resources permitted by their assigned roles. |
| **A02 Cryptographic Failures** | Exposure of participant data and authentication credentials. | Passwords are hashed using bcrypt. Sensitive secrets are stored as environment variables. HTTPS is supported to encrypt client-server communication. |
| **A03 Injection** | SQL injection and malicious input. | Prisma ORM uses parameterized queries while Zod validates incoming request payloads before database operations. |
| **A04 Insecure Design** | Bypass of registration and screening workflows. | Business rules are enforced within backend service layers to prevent unauthorized workflow transitions. |
| **A05 Security Misconfiguration** | Missing security headers or verbose server errors. | Helmet configures HTTP security headers and centralized error handling prevents leaking sensitive implementation details. |
| **A06 Vulnerable and Outdated Components** | Third-party packages containing known vulnerabilities. | Dependencies are periodically reviewed using `npm audit` and updated when security issues are identified. |
| **A07 Identification and Authentication Failures** | Credential theft or unauthorized session access. | JWT authentication, refresh sessions, bcrypt password hashing, password validation, and secure authentication middleware protect user accounts. |
| **A08 Software and Data Integrity Failures** | Tampering with generated QR tokens or application data. | QR tokens are generated using cryptographically secure random values and validated before processing. |
| **A09 Security Logging and Monitoring Failures** | Failure to detect suspicious activities. | Structured audit logs record authentication events, administrative actions, and critical operations for monitoring and troubleshooting. |
| **A10 Server-Side Request Forgery (SSRF)** | Abuse of backend services to access unintended resources. | Backend services communicate only with predefined resources and do not process arbitrary user-supplied URLs for outbound requests. |

---

## 6.2 Authentication, Authorization & Session Management

Authentication is implemented using JSON Web Tokens (JWT). Protected API endpoints require valid authentication tokens before requests are processed.

Authorization is enforced through Role-Based Access Control (RBAC), ensuring that administrators, registration officers, and screening staff only access functionality appropriate to their assigned roles.

Event operations also enforce resource scope, not just a global role name. Event managers may screen only events they created or actively manage; screening staff must have an active `SCREENER` assignment for the requested station. Support and registration assignments cannot write station results. Clinical event aggregates, attendee rows, and management controls require event-level management authority, while ordinary assignees receive only the minimum roster display identity needed for coordination.

Passwords are securely hashed using bcrypt before storage. Refresh sessions support secure re-authentication while reducing repeated login requests.

Sensitive configuration values such as JWT secrets and database credentials are stored using environment variables rather than hard-coded within the application.

---

## 6.3 Data Encryption & Network Hardening

VSMS supports HTTPS communication using TLS certificates to encrypt data transmitted between the frontend and backend.

Helmet automatically configures several HTTP security headers, including:

- Content-Security-Policy (CSP)
- Strict-Transport-Security (HSTS)
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy

These headers reduce the application's attack surface and provide protection against common browser-based attacks.

---

## 6.4 Security Monitoring & Audit Logging

VSMS records important security events using structured audit logging.

Examples include:

- User login attempts.
- Failed authentication.
- Participant registration.
- Administrative actions.
- QR code generation.
- Screening result updates.

These logs assist administrators in monitoring system activity, investigating incidents, and supporting accountability.

## 7. Implementation
### 7.1 Frontend Architecture & Component Structure
### 7.2 Backend Application Services & Lambda Functions
### 7.3 Offline Synchronization Worker Logic

# 8. Testing Results

To ensure the reliability, security, and correctness of the VSMS application, the team implemented a structured testing approach covering functional validation, security verification, and system integration testing.

All test cases were organised within a dedicated `tests` directory, where test files were separated according to their testing purpose. This structure improved test maintainability and allowed different system components to be validated independently.

The testing directory was structured as follows:

```text
tests
│
├── integration
├── security
├── unit
├── helpers.js
└── qrHandoff.extract.test.js
```

### 8.1 Automated Security Scanning (SAST/SCA/Secret Detection)
Automated security scanning was performed throughout development to identify potential vulnerabilities within the application source code and dependencies.

The team conducted Static Application Security Testing (SAST), Software Composition Analysis (SCA), and secret detection.

VSMS implements automated security scanning in the CI/CD pipeline so that vulnerabilities are detected **before** they reach a deployment. Three complementary scanners cover the OWASP categories that depend on tooling rather than code review alone: **Static Application Security Testing (SAST)** for code-level flaws, **Software Composition Analysis (SCA)** for vulnerable third-party components, and **secret detection** for leaked credentials and keys.

All scanners are free, open-source tools run from container images, so the pipeline requires no paid licences, no third-party accounts, and no secrets of its own:

| Scan type | Tool | Scope | When it runs |
| :--- | :--- | :--- | :--- |
| **SAST** | Semgrep (`p/security-audit` + `p/owasp-top-ten`) | Backend + frontend source | PR, push to main, manual |
| **SCA** | `pnpm audit` + OSV-Scanner (Google) | Backend/frontend lockfiles | PR, push to main, nightly |
| **Secret detection** | Gitleaks | Commits introduced by the event | PR, push to main, nightly |
| **Dependency updates** | GitHub Dependabot | npm + GitHub Actions | Weekly / on advisories |

#### 8.1.1 Pipeline Implementation

A dedicated workflow `.github/workflows/security-scan.yml` runs three parallel jobs (`secret-detection`, `sast`, `sca`). It triggers on every pull request, on pushes to `main`, on a nightly schedule, and manually via `workflow_dispatch`. GitHub-native **Dependabot** (`.github/dependabot.yml`) complements the runtime scans by opening version-bump pull requests weekly for both npm packages and GitHub Actions, and automatically for any package affected by a published security advisory.

**Secret detection — Gitleaks.** Gitleaks scans only the commits introduced by the event (the PR base→head range, or the pushed range on `main`), so historical, already-remediated findings never block a merge while any *new* secret immediately fails the build. The configuration `.gitleaks.toml` extends Gitleaks' default rule set and documents the only intentional non-secret matches (`.env.example` placeholder values, analytics column labels such as `key: "waiting"`, and test fixtures such as `signatureObjectKey: "signatures/key"`). The allowlist targets exact string shapes rather than whole files, so a real secret introduced anywhere is still reported.

**SAST — Semgrep.** Semgrep runs the OWASP-aligned and security-audit community rulesets over `backend` and `react-user-dashboard/src` (excluding `node_modules`, `secure-data`, and minified assets). The full JSON report is uploaded as a build artifact for review. The job fails only on **ERROR-severity** findings; WARNING/INFO findings are reported but non-blocking, which keeps the gate strict without a permanent red build from low-severity advisories.

**SCA — pnpm audit + OSV-Scanner.** `pnpm audit` checks each package's lockfile against the npm advisory database (the frozen-lockfile install step also proves the committed lockfiles are in sync, verifying software-supply-chain integrity). OSV-Scanner additionally cross-checks the same three lockfiles against the Google OSV database for a second, independent source of truth.

#### 8.1.2 Findings and Remediation

All three scanners were executed locally against the repository before enabling them in CI, and every actionable finding was remediated:

| Scanner | Initial finding | Remediation | Result |
| :--- | :--- | :--- | :--- |
| **SAST (Semgrep)** | 6 WARNING `raw-html-format` (XSS) findings in `backend/controllers/qrController.js` — participant name, event name, queue number and token preview were interpolated unescaped into the QR pass HTML page | Added an `escapeHtml` helper and applied it to every interpolated value; the embedded `statusUrl` is now emitted with `JSON.stringify` instead of raw string concatenation | 0 blocking (ERROR) findings |
| **SCA (pnpm audit)** | 1 moderate advisory GHSA-fxqj-rqcc-2cmp: `postcss ≤8.5.22` in the frontend build toolchain | Bumped the frontend `postcss` devDependency `^8.5.3 → ^8.5.23` (resolved to `8.5.26`) and regenerated the lockfile | 0 vulnerabilities in both packages |
| **SCA (OSV-Scanner)** | No issues in any of the three lockfiles | — | No issues found |
| **Secret detection (Gitleaks)** | Current code clean; 4 findings in git *history*: two localhost TLS dev private keys (`backend/certs/key.pem`, `react-user-dashboard/certs/localhost-key.pem`), a hardcoded `ENCRYPTION_KEY` fallback that has since been removed from `cryptoUtils.js`, and a 128-character `JWT_SECRET` committed in `.env.example` | Dev certificates were already removed from the working tree and are gitignored (regenerated per machine); the hardcoded key fallback was replaced with per-environment generated keys; the `.env.example` secret was scrubbed to a `replace-with-…` placeholder | Introduced commits clean (0 findings) |

The SAST XSS fix is representative of the value of the pipeline: participant-supplied names are now escaped before being placed into the generated HTML document, closing a stored-XSS path where a malicious name could otherwise execute script in the QR pass page served to any staff member who scans it. Backend tests (`qr-service-security` suite) continue to pass at 18/18 after the fix.

#### 8.1.3 Local Verification

Every scanner is also runnable locally with a single command, which is how the findings above were collected:

```bash
# Secret detection (full history; PRs only scan introduced commits in CI)
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 detect \
  --source=/repo --config=/repo/.gitleaks.toml --redact --log-opts="HEAD"

# SAST
docker run --rm -v "$PWD:/src" -w /src returntocorp/semgrep:1.170.1 semgrep scan \
  --config p/security-audit --config p/owasp-top-ten --metrics off \
  --exclude node_modules --exclude secure-data --json --output semgrep-report.json \
  backend react-user-dashboard/src

# SCA
pnpm audit
docker run --rm -v "$PWD:/src" -w /src ghcr.io/google/osv-scanner:v2.5.0 scan \
  --lockfile /src/backend/pnpm-lock.yaml \
  --lockfile /src/react-user-dashboard/pnpm-lock.yaml \
  --lockfile /src/pnpm-lock.yaml
```

#### 8.1.4 Continuous Operation

- **Every pull request and push to `main`** re-runs all three scans; new secrets or ERROR-severity code flaws block the merge.
- **Nightly** scans catch newly published advisories in the dependency tree even when no code changes occur.
- **Dependabot** opens remediation pull requests automatically, and GitHub's built-in secret scanning and push protection provide a further safety net for leaked credentials.

Together these controls address **A06 (Vulnerable and Outdated Components)**, **A08 (Software and Data Integrity Failures)** and — by keeping credentials out of the repository — **A02 (Cryptographic Failures)** and **A07 (Identification and Authentication Failures)** from the OWASP Top 10.

### 8.2 Functional Validation & Exception Handling Reports
#### 8.2.1 Core Registration Endpoint Validation (`POST /participants`)
The participant registration process was tested to ensure proper request parsing, multi-table database transaction processing, and strict HTTP response security header enforcement.

* **Test Objective:** Verify successful creation of a new participant record along with its associated event registration entry in an ACID-compliant database transaction.
* **Input Payload:** Standard registration payload containing sensitive demographic data (NRIC, contact information) alongside structural foreign keys (`eventId`, `userId`).
* **Observed Result:** `HTTP/1.1 201 Created` returned in 165ms.
<img width="701" height="567" alt="image" src="https://github.com/user-attachments/assets/113cf5e9-91d1-4ccb-8b21-c6382238fb04" />

```json
POST https://localhost:5050/api/v1/participants
Content-Type: application/json

{
  "nric": "S1234567A",
  "firstName": "John",
  "lastName": "Doe",
  "dateOfBirth": "1990-01-01",
  "gender": "M",
  "contactNumber": "91234567",
  "emergencyContact": "98765432",
  "consentGiven": true,
  "eventId": "01f6b64b-d80d-427e-9d43-...",
  "userId": "5464da13-1d47-45ba-8e10-..."
}
```
### 8.2.2 Security Control & Header Verification
As demonstrated in the response headers of Figure 8.1, the application layer successfully enforces strict defensive headers via HTTP middleware to prevent common web vulnerabilities:

- Strict Content Security Policy (CSP): Restricts script execution and limits connections exclusively to trusted endpoints ('self' and https://api.vsms-screening.org).
- Clickjacking Protection: Configured with X-Frame-Options: SAMEORIGIN and frame-ancestors 'none'.
- Transport & MIME Hardening: Enforces Strict-Transport-Security (HSTS max-age 1 year) and X-Content-Type-Options: nosniff to eliminate protocol downgrade and MIME-sniffing vectors.

### 8.3 Rate Limiting & Concurrency Testing Verification

## 9. Bonus Features
### 9.1 Infrastructure Hardening (AWS S3, Secret Manager & Cognito Integration)
### 9.2 Event-Driven Architecture & Automated QR Capabilities
### 9.3 Responsive Design & Real-Time Operational Dashboard

## 10. Deployment Guide
### 10.1 Environment Configurations & Prerequisites
### 10.2 Database Scripts & Infrastructure-as-Code (IaC) Setup
### 10.3 Application Build & Deployment Automation

## 11. Reflection & Appendices

This section presents our team's reflections and supporting appendices from the development of the secure web application. It highlights the experiences gained throughout the project, challenges encountered, technical knowledge acquired, and improvements identified for future development. Through this project, we gained practical experience in applying secure software engineering principles while balancing functionality, usability, and security requirements.

The development process allowed us to understand that security should not be treated as a final stage of development, but rather as an integral part of the entire Software Development Life Cycle (SDLC). From initial system design and database modelling to implementation, testing, and validation, security considerations influenced many of our technical decisions.

---

## 11.1 Group Reflection & Technical Lessons Learned

Throughout this project, our team gained valuable experience in designing and developing a secure web application. We encountered various challenges, including managing a complex database structure, integrating multiple application components, implementing authentication and authorization mechanisms, and ensuring that security requirements were properly addressed.

One of the key lessons learned was the importance of proper planning before implementation. As the system consisted of multiple modules such as participant registration, screening workflows, user management, reporting, and security monitoring, early architectural planning was essential to prevent unnecessary redesign and integration difficulties.

From a technical perspective, this project strengthened our understanding of secure coding practices, including input validation, role-based access control (RBAC), password security, API protection, logging, error handling, and vulnerability mitigation based on the OWASP Top 10. We also gained experience in performing security testing through methods such as static analysis, dependency scanning, functional validation, and security configuration checks.

Working with technologies such as Node.js, Express, PostgreSQL, Prisma, and cloud-based services improved our understanding of developing scalable backend systems. We learned that building a secure application requires consideration across all layers, including frontend validation, backend enforcement, database integrity, and infrastructure configuration.

The following table summarises our team's key achievements, technical lessons learned, and areas for future improvement:

| Area | What We Did | What We Learned | What We Can Improve |
|---|---|---|---|
| **System Architecture & Design** | Designed the overall system architecture, component interactions, and application workflow to support different user roles and system functions. | A clear architecture helps ensure better maintainability, scalability, and easier integration between components. | Spend more time validating system design decisions earlier and create detailed architecture documentation before development begins. |
| **Database Design & Modelling** | Created an Entity Relationship Diagram (ERD), designed database tables, established relationships, and implemented database operations using Prisma and PostgreSQL. | Database design has a significant impact on application performance, data consistency, and future expansion. | Conduct more database reviews earlier and confirm relationships before implementation to reduce schema changes later. |
| **Authentication & Authorization** | Implemented authentication workflows, password protection, role-based access control (RBAC), and permission checks to restrict unauthorized access. | Authentication verifies identity while authorization ensures users can only perform permitted actions. Both are essential for application security. | Further improve authentication security by exploring stronger mechanisms such as multi-factor authentication and more secure session management approaches. |
| **Secure Coding Practices** | Applied security measures such as input validation, parameterized queries, secure error handling, environment variable protection, and API validation. | Security controls should be incorporated during development rather than added after vulnerabilities are discovered. | Perform security reviews earlier and establish secure coding guidelines before implementation begins. |
| **API Development** | Developed backend APIs for system operations and implemented middleware for validation, authentication, and security checks. | Well-designed APIs require consistent error handling, validation, documentation, and access control. | Improve API documentation and increase automated API testing coverage throughout development. |
| **Security Testing & Validation** | Conducted security scans, dependency checks, functional testing, and validation of security-related features. | Testing helps identify vulnerabilities and ensures that security controls work as intended. | Integrate automated security testing earlier into the development workflow and perform more frequent security reviews. |
| **Error Handling & Logging** | Implemented structured error handling and logging mechanisms to improve system monitoring and debugging. | Proper logging helps identify issues while maintaining accountability and system visibility. | Improve log management practices by defining clearer logging standards and monitoring strategies. |
| **Team Collaboration** | Used version control, task delegation, documentation, and regular discussions to coordinate development activities. | Effective teamwork and communication are critical when developing a large-scale application. | Improve task estimation, conduct more frequent integration reviews, and resolve conflicts earlier during development. |
| **Project Management** | Followed an Agile-inspired development approach with iterative improvements, sprint planning, and continuous feedback. | Breaking down complex requirements into smaller milestones improves productivity and progress tracking. | Allocate additional time for initial planning, risk analysis, and final system integration before submission. |

Overall, this project provided our team with valuable practical experience in secure software development. While we successfully implemented important security controls and functional requirements, we also identified areas where our development process could be improved. The experience reinforced the importance of security awareness, effective collaboration, continuous testing, and careful planning when building reliable and secure applications.

---

## 11.2 Individual Reflection

### Member 1 Reflection

During this project, I gained a deeper understanding of secure software development and the importance of considering security throughout the development process. Working on the project exposed me to real-world challenges such as integrating multiple system components, debugging complex issues, and ensuring that implemented features followed security best practices.

I improved my technical skills in backend development, database management, API implementation, and security validation. Through troubleshooting various issues, I learned that effective problem-solving requires analysing the interaction between different layers of the application rather than focusing only on individual components.

Moving forward, I aim to improve my ability to plan technical solutions earlier, write more comprehensive documentation, and strengthen my understanding of advanced security concepts to develop more robust applications.

### Member 2 Reflection

This project provided valuable experience in applying theoretical security concepts into a practical application. I learned the importance of implementing security measures such as access control, input validation, and secure data handling to protect application resources.

Working with team members also improved my communication and collaboration skills. I learned that effective coordination and sharing of knowledge are essential when working on a large software project with multiple interconnected features.

In future projects, I hope to improve my testing approach by incorporating more automation and conducting security assessments earlier in the development process.

### Member 3 Reflection

Throughout the project, I gained a better understanding of the challenges involved in developing a complete secure application. The process of designing, implementing, and testing different features helped me understand how individual components contribute to the overall system.

One important lesson learned was that security and functionality must be developed together. Adding security considerations early reduces potential issues and improves the overall quality of the application.

For future projects, I would like to improve my technical planning skills, increase my familiarity with security tools, and contribute more actively during the initial design phase.

---

## 11.3 Appendices

The appendices contain additional supporting materials and evidence collected throughout the project. These materials provide further details regarding the implementation process, testing procedures, and security validation performed.

The appendices include:

| Appendix | Description |
|---|---|
| **Appendix A: System Architecture Diagrams** | Contains component diagrams, system workflows, and architectural designs illustrating application structure and interactions. |
| **Appendix B: Database Design Documentation** | Contains ERD diagrams, database schemas, and relationship mappings used during system development. |
| **Appendix C: API Documentation** | Contains API endpoint details, request formats, response structures, and authentication requirements. |
| **Appendix D: Security Testing Results** | Contains results from security scans, dependency analysis, vulnerability checks, and validation reports. |
| **Appendix E: Functional Testing Evidence** | Contains test cases, screenshots, validation results, and exception handling verification. |
| **Appendix F: Additional Implementation Evidence** | Contains additional screenshots, configuration details, and supporting materials referenced throughout the report. |

These appendices provide additional evidence of the development process and demonstrate the team's effort in building a secure, functional, and maintainable web application.

### 11.2 References
### 11.3 Declaration of Academic Integrity
