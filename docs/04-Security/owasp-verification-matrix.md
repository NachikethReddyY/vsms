# OWASP Top 10:2025 verification matrix

This matrix uses the current [OWASP Top 10:2025](https://owasp.org/Top10/) as
an awareness and verification framework. It does **not** claim certification.
Each category needs implementation evidence, an automated negative test, and,
where applicable, a sanitized live result before the final report may call it
verified.

| Category | Implemented controls | Repeatable evidence | Status / residual work |
| --- | --- | --- | --- |
| A01 Broken Access Control | Cognito identity is intersected with active local account state, event membership, event role, active shift and station duty. Cross-event data is scoped in services. | `backend/tests/security/screening-authorization.test.js`, `event-reporting-security.test.js`, `role-and-staff-management.test.js` | Automated. Complete the synthetic wrong-event and inactive-duty browser replay. |
| A02 Security Misconfiguration | Fail-closed environment validation, Helmet, exact CORS origins, bounded bodies, separate liveness/readiness, private network/database IaC and non-root container execution. | `backend/config/env.js`, `backend/app.js`, `backend/Dockerfile`, `.vsms/tests/availability-*.test.js` | Automated source checks. Retain deployed header and TLS evidence. |
| A03 Software Supply Chain Failures | Frozen pnpm lockfiles, dependency audit/OSV, Semgrep, Gitleaks and reproducible Prisma generation in the production image. | `pnpm-lock.yaml`, `backend/pnpm-lock.yaml`, `backend/Dockerfile`, security workflow results | Automated in CI. Record the final green workflow URLs in the submission evidence. |
| A04 Cryptographic Failures | TLS at the edge, encrypted RDS/storage, KMS/Secrets Manager boundaries, AES-256-GCM offline records with associated data, hashed QR lookup tokens and contextual token encryption. | `infrastructure/availability.yaml`, `react-user-dashboard/src/features/screening/offlineSync.test.ts`, `backend/services/participant/qrService.js` | Automated implementation checks. Key-rotation and deployed TLS evidence remain operational proof. |
| A05 Injection | Zod request schemas, Prisma parameterized access, strict UUID/token validation, output encoding and constrained report/export parameters. | `backend/schemas/`, `backend/tests/security/security.test.js`, OpenAPI contract checks | Automated. Add an approved ZAP API scan result to the final evidence bundle. |
| A06 Insecure Design | Threat model, least-data offline pack, service-owned authorization and transactions, idempotency ledgers, immutable audits, reviewer-owned decisions and explicit availability failure modes. | `backend/docs/threat-model.md`, `backend/docs/request-architecture.md`, `backend/docs/offline-screening-28.md` | Designed and tested. Review threat treatments after the final deployment configuration is frozen. |
| A07 Authentication Failures | Cognito authorization-code + PKCE, MFA, secure HttpOnly cookies, CSRF checks, session/account revocation and rate limits. | `backend/tests/security/cognito-oauth.test.js`, `cookie-session-security.test.js`, `backend/utils/auth/` | Automated locally; invitation, MFA and revoked-session journeys require synthetic Cognito evidence. |
| A08 Software or Data Integrity Failures | Screening and QR mutations use idempotency keys and request fingerprints; sync transitions and domain outbox delivery are durable; audit rows have database immutability guards. | `backend/tests/unit/idempotency.test.js`, `sync-service.test.js`, `backend/prisma/migrations/` | Automated. Preserve signed build/deployment revision in the live evidence record. |
| A09 Security Logging and Alerting Failures | Correlated Pino HTTP logs with redaction, immutable domain/auth audits, security-critical outcome coverage and CloudWatch alarms in availability IaC. | `backend/tests/unit/http-logging.test.js`, `screening-audit.test.js`, `backend/docs/security/audit-trail.md` | Logging is automated. Alarm delivery and response ownership need a live drill. |
| A10 Mishandling of Exceptional Conditions | Central safe error handler, atomic transactions, explicit conflict states, bounded retries, graceful shutdown, liveness/readiness separation and restore verification. | `backend/errors/AppError.js`, `backend/middlewares/errorHandler.js`, `.vsms/tests/availability-*.test.js`, `docs/2026-08-13-performance-recovery.md` | Automated. Run one dependency-failure drill against the final environment. |

## Final evidence gate

Before submission, retain only synthetic and sanitized evidence for:

1. one allowed and one denied request for every staff role;
2. an offline save followed by exactly one committed replay;
3. a failed dependency where `/health` remains live and `/ready` reports not ready;
4. dependency, secret, static-analysis and ZAP summaries;
5. a restore comparison covering rows, constraints and indexes; and
6. the deployed revision, timestamp, environment and responsible tester.

Use `docs/06-Testing/live-acceptance.md`; never put credentials, tokens, NRICs,
clinical payloads or unredacted screenshots into Git.
