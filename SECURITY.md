# Visual Screening Management System (VSMS) — Security Policy

## 1. Overview

The **Visual Screening Management System (VSMS)** is designed to protect participant information, screening results, user accounts, and operational data through a layered security approach.

This policy defines:
* Supported application versions and maintenance lifecycles
* Implemented core security controls aligned with industry standards
* Vulnerability disclosure and handling procedures
* Expectations for contributors, developers, and maintainers

> **Principle:** Security is treated as an architectural requirement throughout development rather than as a final-stage implementation task.

---

## 2. Supported Versions

Security fixes and patches are actively provided for supported releases of VSMS.

| Version | Security Support | Status |
| :---: | :---: | :---: |
| `2.x` | **Yes** | Current / Active |
| `1.x` | **Limited** | Maintenance |
| `< 1.0` | **No** | Unsupported |

> **Note:** Version numbers must be updated whenever a new production release is made.

---

## 3. OWASP Top 10 Security Baseline

VSMS aligns its core security controls directly with the **OWASP Top 10 (2021)** framework.

| Category | OWASP Category Name | Implementation / VSMS Control Evidence |
| :--- | :--- | :--- |
| **A01** | Broken Access Control | Backend Role-Based Access Control (RBAC), authorization matrix, forbidden-access tests. |
| **A02** | Cryptographic Failures | TLS 1.3 in transit, AES-256 at rest, secure secret configuration. |
| **A03** | Injection | Zod/schema validation, parameterized database queries, safe error handling. |
| **A04** | Insecure Design | Threat modeling, abuse cases, and architecture-level mitigations. |
| **A05** | Security Misconfiguration | Secure HTTP headers, environment variable isolation, session timeouts, secure defaults. |
| **A06** | Vulnerable & Outdated Components | Continuous dependency scanning, vulnerability reviews, and timely patching. |
| **A07** | Identification & Authentication Failures | Strong password policies, secure hashing, MFA support, protected token handling. |
| **A08** | Software & Data Integrity Failures | Idempotency keys, duplicate-request prevention, and safe retry handling. |
| **A09** | Security Logging & Monitoring Failures | Immutable audit logging for authentication, participant, screening, and admin actions. |
| **A10** | Server-Side Request Forgery (SSRF) | Outbound URL validation, strict allow-listing, and controlled redirect handling. |

---

## 4. Core Security Controls

### 4.1 Authentication
To protect user accounts, authentication controls enforce the following:
* Strong password complexity requirements
* Secure password hashing (e.g., Argon2id or bcrypt)
* Session timeouts and secure token lifecycle management
* Rate-limiting against brute-force attempts
* Multi-Factor Authentication (MFA) support where applicable
* Immediate token invalidation upon logout
* **Zero plaintext storage** of credentials or secrets in codebases/repositories

---

### 4.2 Role-Based Access Control (RBAC)
VSMS enforces the **Principle of Least Privilege**. Backend authorization guarantees that users can only perform operations relevant to their role.

| Role | Core Responsibilities & Permissions |
| :--- | :--- |
| **Administrator** | Manage users, system roles, and global configurations. |
| **Event Manager** | Manage screening events, stations, and staff allocations. |
| **Registration Officer** | Register, look up, and update participant records. |
| **Screener** | Record clinical screening test results. |
| **Reviewer** | Evaluate results, finalize diagnoses, and generate referrals. |

---

### 4.3 Input Validation & Sanitization
* **Schema Validation:** Strictly typed request validation (e.g., Zod) on all inbound endpoints.
* **Query Safety:** Parameterized queries or ORM abstraction to eliminate SQL Injection.
* **Sanitization:** String sanitization to prevent Cross-Site Scripting (XSS).
* **Fail-Safe Processing:** Invalid payloads are rejected at the edge before reaching business logic or database operations.

---

### 4.4 Cryptography & Data Protection
* **In Transit:** Mandatory **TLS 1.3** for all client-server and inter-service communications.
* **At Rest:** Sensitive fields and participant health details encrypted via **AES-256**.
* **Secrets Management:** Environment-specific configuration; production secrets are never committed to version control.

---

### 4.5 Secure Configuration & Infrastructure
The application uses secure defaults and avoids exposing sensitive configuration:
* Environment variables for secrets management
* Secure HTTP headers and appropriate CORS configuration
* Session timeout and disabled debug output in production
* Restricted database permissions and removal of unnecessary services/endpoints

---

### 4.6 Dependency Security
Third-party dependencies are reviewed regularly for known vulnerabilities through automated scanning:
1. Identify vulnerable packages
2. Assess vulnerability severity
3. Upgrade affected dependencies
4. Document accepted risks where immediate remediation is not possible

---

### 4.7 API Security & Endpoints
Protected endpoints mandate backend token validation, access checks, and rate limiting.

Example protected endpoints:
```text
POST   /api/v1/events
GET    /api/v1/events
PUT    /api/v1/events/:id
DELETE /api/v1/events/:id

POST   /api/v1/participants
GET    /api/v1/participants/:id
PUT    /api/v1/participants/:id

POST   /api/v1/screening/visual-acuity
POST   /api/v1/screening/refraction
POST   /api/v1/screening/colour-vision
POST   /api/v1/screening/eye-health

POST   /api/v1/sync/batch
```
## 5. Offline Synchronization Security

Because VSMS operates in offline environments, synchronization is a critical attack surface. The system prevents duplicate records, unauthorized synchronization, replay attacks, and data corruption during retries.

### Key Safeguards
* **Operation IDs & Idempotency Keys:** Prevents duplicate records during network retries.
* **Replay Protection & Server Authorization:** Ensures stale or intercepted payloads are rejected and rights are checked.
* **Conflict Detection & Audit Logging:** Resolves state conflicts safely without overwriting data illicitly while capturing all sync operations.

### Queue Lifecycle Flow

```text
       [ PENDING ] 
            │
            ▼
      [ PROCESSING ] ──────┐ (On Failure)
            │              │
            ├──────────────┼──────────────┐
            ▼              ▼              ▼
       [ SUCCESS ]    [ FAILED ] ──► [ RETRY ]
```

## 6. Audit Logging
Critical operational actions are recorded in an append-only audit log.

Logged Events
Authentication events (login, logout, failed attempts)

Administrative changes (user creation, disabling, role modifications)

Event and participant management actions

Screening result creation, modification, and evaluation

Data synchronization executions and security events

Audit Record Requirements
Every entry captures:

Who performed the action (User ID / Role)

What action was performed

When the action occurred (UTC Timestamp)

Which resource was affected

Whether the operation succeeded or failed

[!WARNING]

Passwords, authentication tokens, encryption keys, and sensitive participant PII must never be written to logs.

7. Security Testing & Evidence
Security testing forms a core part of the development lifecycle and includes:

Authentication, RBAC, and forbidden-access testing

Input validation, injection, and session-management tests

API security and rate-limiting validation

Automated dependency scanning and secure configuration checks

Offline synchronization, idempotency, and duplicate-request tests

Retained Security Evidence
The following artifacts are maintained as evidence of security implementation:

OWASP Top 10 control mapping & Role/permission matrix

Threat model and security architecture diagrams

Secure API design and authentication/encryption flow documentation

Audit-log schema and dependency scan results

Security, forbidden-access, input-validation, and sync test reports

## 8. Vulnerability Management
### 8.1 Reporting a Vulnerability
If you discover a potential security flaw in VSMS, please report it privately:

Do not disclose the issue publicly (e.g., public GitHub issues).

Report security issues directly to the project maintainers or designated security contact.

Include:

- Description of the vulnerability and affected components

- Step-by-step reproduction steps or proof-of-concept

- Potential security impact and suggested mitigations (if known)

Reminder: Do not include passwords, access tokens, private keys, participant personal information, or other sensitive data in vulnerability reports.

### 8.2 Vulnerability Handling Process
Plaintext
```
  [ Report Received ]
          │
          ▼
 [ Initial Assessment ]
          │
          ▼
[ Severity Classification ]
          │
          ▼
   [ Reproduction ]
          │
          ▼
    [ Remediation ]
          │
          ▼
  [ Security Testing ]
          │
          ▼
 [ Deployment & Release ]
```

## 9. Core Security Principles
- Least Privilege: Users receive only the permissions required for their specific role.

- Defense in Depth: Multiple overlapping security layers across UI, API, Database, and Network infrastructure.

- Secure by Design: Security requirements are integrated into architecture and development from the start.

- Fail Securely: Unexpected errors fail safely without exposing stack traces, sensitive information, or bypassing access controls.

- Data Minimization: Only information necessary for operational and screening requirements is collected and retained.

- Auditability: Security-sensitive and business-critical operations remain traceable through audit records.

## 10. Scope
This security policy applies to:

- VSMS Frontend application and Web UI

- VSMS REST API & Backend services

- Offline synchronization client and data persistence layers

- Database storage and deployment infrastructure

- Third-party dependencies and security documentation
