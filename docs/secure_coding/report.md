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

## 2.1 Functional Requirements

### Authentication and Session Management

- Secure user authentication using JWT-based authentication.
- Passwords are securely hashed using bcrypt before storage.
- Refresh token/session management is implemented to improve security and reduce risks associated with long-lived access tokens.
- Authentication endpoints enforce strong password requirements using Zod validation.

### Participant Management

- Staff can register and manage participant records.
- Duplicate participant creation is prevented through database constraints.
- Participant data retrieval is restricted according to user roles.

### QR Verification Workflow

- The system generates unique QR tokens using cryptographically secure random generation.
- QR codes contain only token references and do not expose participant information.
- Tokens can be validated, expired, revoked, and tracked through QRCodePass records.

### Queue and Screening Workflow

- Participants are assigned queue positions during screening events.
- Staff can update participant progress across different screening stations.
- Queue states are synchronised between registration and screening workflows.

### Offline Capability

The frontend is designed using Progressive Web Application (PWA) principles to support unstable network environments commonly found during community screening events.

Offline capabilities allow temporary local storage of required workflow information and synchronisation when connectivity is restored.

---

## 2.2 Non-Functional Requirements

### Performance

- Database queries are optimised using Prisma ORM relationships and indexing.
- Frequently accessed records such as participant lookup, QR verification, and queue status updates are designed for efficient retrieval.

### Security

VSMS follows secure coding practices aligned with the **OWASP Top 10 (2021)** framework. Security controls are implemented across the application architecture, including the frontend, backend API layer, authentication system, database layer, and deployment environment.

The system adopts a defence-in-depth security approach by applying preventive, detective, and corrective security measures to protect Personally Identifiable Information (PII), screening records, authentication credentials, and operational workflows.

| OWASP Category | Security Controls Implemented |
|---|---|
| **A01: Broken Access Control** | VSMS implements Role-Based Access Control (RBAC) through backend authorization middleware. Protected API endpoints validate authenticated users and their assigned roles before allowing access to sensitive operations such as participant management, screening workflows, and administrative functions. This prevents unauthorised access and privilege escalation. |
| **A02: Cryptographic Failures** | Sensitive information is protected through cryptographic security controls. HTTPS enforcement protects data transmitted between frontend clients and backend services. User passwords are securely stored using bcrypt hashing, while authentication tokens and sensitive session data are handled using secure token management practices. Encryption mechanisms are applied to protect sensitive stored information where required. |
| **A03: Injection** | VSMS applies multiple layers of input protection. Client and server-side validation is implemented using Zod schemas to ensure incoming requests follow expected formats. Prisma ORM is used for database communication, providing parameterised queries that prevent unsafe SQL execution and reduce SQL injection risks. |
| **A04: Insecure Design** | Threat modelling was conducted during the system design phase to identify potential security risks involving authentication, authorization, participant data handling, QR verification, API communication, and workflow manipulation. Identified threats were analysed and mapped to appropriate mitigation controls before implementation. |
| **A05: Security Misconfiguration** | Secure configuration practices are enforced through environment-based configuration management, restricted CORS policies, Helmet security middleware, secure HTTP headers, disabled Express fingerprinting (`x-powered-by`), and controlled production settings. API documentation exposure is restricted to non-production environments to reduce unnecessary information disclosure. |
| **A06: Vulnerable and Outdated Components** | VSMS performs dependency security checks to identify vulnerable or outdated third-party libraries and packages. Dependency scanning tools are used to detect known vulnerabilities (CVEs), outdated components, and potential software supply-chain risks. Identified issues are reviewed and mitigated through dependency updates or security fixes. Threat modelling also considers risks introduced through external dependencies and system components. |
| **A07: Identification and Authentication Failures** | Authentication security is implemented using JWT-based authentication, bcrypt password hashing, password policy enforcement, refresh session management, secure cookie handling, and session timeout controls. Rate limiting is applied to authentication endpoints to reduce brute-force attack risks. MFA is included as an additional security enhancement for stronger account protection. |
| **A08: Software and Data Integrity Failures** | API integrity is supported through bounded idempotency keys and payload binding, reducing duplicate or mismatched event operations. Serializable and atomic database transactions maintain consistency during event deletion, participant registration, queue updates, and screening submissions. The repository's optional code-signature prototype is not a release assurance by itself; production must enforce signed, immutable artifacts and lockfile verification in the deployment pipeline before claiming startup integrity. |
| **A09: Security Logging and Monitoring Failures** | Security monitoring is supported through request logging, request context tracking, and audit logging mechanisms. Important activities such as authentication events, administrative actions, QR verification attempts, and security-sensitive operations are recorded to support accountability, investigation, and troubleshooting. |
| **A10: Server-Side Request Forgery (SSRF)** | External resource requests are controlled through allow-list validation where applicable. Restricting permitted external destinations reduces the possibility of attackers forcing backend services to access unauthorised internal resources. |

---

## Additional Security Controls

Beyond OWASP Top 10 alignment, VSMS implements additional defence-in-depth controls to strengthen application security.

### Rate Limiting

API rate limiting is implemented using request throttling mechanisms to reduce risks from excessive requests, automated attacks, and brute-force attempts.

Examples include:

- Authentication endpoints applying stricter request limits.
- Mutation endpoints limiting repeated state-changing operations.
- QR-related operations protected against excessive requests.

---

### Secure HTTP Headers

Helmet middleware is implemented to provide additional browser security protections.

Security headers include:

- Content Security Policy (CSP).
- Protection against common browser-based attacks.
- Reduction of unnecessary HTTP metadata exposure.

The application also disables Express framework fingerprinting to prevent unnecessary technology disclosure.

---

### HTTPS Enforcement and Encryption in Transit

Production environments enforce HTTPS communication by rejecting insecure HTTP requests.

TLS-based communication protects sensitive data exchanged between:

- Frontend users.
- Backend API services.
- External integrations.

This prevents attackers from intercepting sensitive information during transmission.

---

### CORS Protection

Cross-Origin Resource Sharing (CORS) is restricted through an allow-list approach.

Only approved frontend origins are permitted to communicate with backend APIs.

This prevents unauthorised external applications from interacting with protected resources.

---

### Secure Request Processing

Incoming API requests are protected through multiple validation and security layers:

- JSON payload size restrictions.
- Strict content-type validation.
- Authentication verification.
- Authorization checks.
- Zod schema validation.
- Centralised error handling.
- Request identification through request IDs.

These controls reduce risks from malformed requests, abuse attempts, and invalid data submission.

---

### Session Security

Authentication sessions are protected through:

- JWT token verification.
- Refresh session management.
- Secure cookie handling.
- Session timeout mechanisms.

These controls reduce the impact of stolen credentials and prevent prolonged unauthorised access.

---

### Dependency Security Management

VSMS performs dependency security checks to maintain a secure software supply chain.

Dependency analysis identifies:

- Known Common Vulnerabilities and Exposures (CVEs).
- Outdated third-party packages.
- Vulnerable transitive dependencies.
- Potential supply-chain security risks.

Security findings are reviewed and addressed through dependency updates, upgrades, or mitigation measures.

---

### Software Integrity Verification

VSMS does not currently claim runtime artifact-signature verification. The previous optional startup prototype silently skipped verification when signature files were absent, checked a source file against a differently named build artifact, and had a second unused implementation. It was removed to avoid presenting a non-enforced control as release assurance.

Production delivery must enforce integrity in the deployment pipeline before release by using:

- SHA-256 cryptographic hashing.
- Digital signatures.
- Public key verification.

The pipeline must reject a missing or invalid signature and deploy only the immutable artifact that was actually verified. This remains a deployment requirement; it was not simulated locally and no cloud environment was changed.

This protects against:

- Unauthorised code modification.
- Tampered deployment artifacts.
- Software supply-chain attacks.

---

### Password Security

User authentication security is strengthened through:

- bcrypt password hashing.
- Strong password requirements.
- Server-side password validation.
- Protection against invalid authentication attempts.

Plain-text passwords are never stored within the system.

---

### Audit Logging

VSMS maintains audit records for security-sensitive operations.

Logged activities include:

- User authentication events.
- Administrative changes.
- QR verification activities.
- Screening workflow updates.
- Important system actions.

Audit logs support accountability, monitoring, and security investigations.

---

# Reliability

VSMS is designed to maintain availability, consistency, and reliability during community screening operations.

## ACID-Compliant Database Transactions

PostgreSQL transactions ensure that critical workflows maintain consistency even when multiple users interact with the system simultaneously.

Examples include:

- Participant registration.
- Screening result submission.
- Queue status updates.
- QR verification records.

---

## Idempotent API Processing

Critical operations support idempotent request handling through Idempotency-Key validation.

This prevents:

- Duplicate participant registrations.
- Multiple queue assignments.
- Repeated screening submissions.
- Duplicate transactions caused by network retries.

---

## Multi-Layer Validation

Data integrity is maintained through multiple validation layers:

- Frontend validation improves user experience.
- Backend Zod validation enforces security requirements.
- Prisma schema constraints maintain database consistency.

---

## Error Handling and Recovery

Centralised error handling middleware provides:

- Consistent API responses.
- Controlled failure handling.
- Prevention of sensitive stack trace exposure.
- Generic messages for unknown exceptions; bounded legacy status hints retain correct HTTP semantics, while unclassified failures become generic 500 responses.
- Improved troubleshooting capability.

---

## Offline Operation Support

The Progressive Web Application (PWA) architecture enables temporary offline workflows and later synchronisation when network connectivity is restored.

This improves system availability during community screening events where network reliability may be limited.

---

## Database Integrity Controls

PostgreSQL maintains reliable data relationships through:

- Primary keys.
- Foreign keys.
- Unique constraints.
- Relationship validation.
- Transaction management.

These mechanisms ensure participant records, screening results, QR tokens, and operational data remain accurate and consistent.

## 2.3 Use Case Analysis

### Participant Check-In Use Case

1. Registration staff create or verify participant information.
2. The system generates a unique QR verification token.
3. The participant receives a QR code containing only the secure token reference.
4. Screening staff scan the QR code at assigned stations.
5. The backend validates the token and retrieves authorised participant information.
6. Screening results are recorded and linked to the participant's screening journey.

This workflow ensures efficient participant movement while maintaining confidentiality of sensitive information.

---

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
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:latest detect \
  --source=/repo --config=/repo/.gitleaks.toml --redact --log-opts="HEAD"

# SAST
docker run --rm -v "$PWD:/src" -w /src returntocorp/semgrep semgrep scan \
  --config p/security-audit --config p/owasp-top-ten --metrics off \
  --exclude node_modules --exclude secure-data --json --output semgrep-report.json \
  backend react-user-dashboard/src

# SCA
pnpm audit
docker run --rm -v "$PWD:/src" -w /src ghcr.io/google/osv-scanner:latest scan \
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
