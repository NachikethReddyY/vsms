# VSMS evidence-backed feature checklist

This checklist describes the current repository, not the original proposal.

Legend: `[x]` evidence is present in the current source; `[~]` is partial or
configuration-dependent; `[ ]` is planned/deferred; `[?]` requires a human or
external artifact. A checked item is not a claim of live deployment or
measured performance.

## Core workflow

- [x] Event create, update, lifecycle transitions, station setup and staffing — `backend/services/event/`, event routes, Prisma `Event`/`Station`/`Shift` models.
- [x] Account approval, suspension, reactivation, deprovisioning and event-scoped roles — `backend/services/account/`, admin routes, event membership services.
- [x] Cognito authorization-code + PKCE callback and secure-cookie session exchange — `backend/routes/authRoutes.js`, `authController.js`, `utils/cognitoClient.js`.
- [x] Participant search, create, update, consent, emergency contacts and event registration — participant/registration routes and services.
- [x] QR issue, verification, reissue, revocation, download and print paths — `backend/services/participant/qrService.js` and QR routes.
- [x] Queue join, hand-off, call, start, advance, complete, skip and priority — queue routes and `services/screening/queueService.js`.
- [x] Visual-acuity, refraction and colour-vision station save/preview paths with server-side flags — `screeningService.js`, OpenAPI and station pages.
- [x] Review decisions and referral issue/revision/acknowledgement/document paths — `reviewService.js`, `referralService.js` and routes.
- [x] Metrics, analytics, operational reports and queued PDF/CSV export source paths — `services/reporting/` and OpenAPI.

## Offline and PWA boundary

- [x] Download a scoped assigned-station snapshot while online.
- [x] Encrypt the offline snapshot and mutation records with browser AES-GCM.
- [x] Strip pass tokens from offline queue data and bind stored records to user/event scope.
- [x] Save supported station mutations offline with client action IDs and preliminary rule flags.
- [x] Reconnect and sync through `POST /api/v1/events/{eventId}/sync/screening`.
- [x] Preserve retryable network failures and surface server conflicts for staff attention.
- [x] Purge expired offline packs and clear them on logout/user change.
- [~] Responsive React/Vite browser application with offline screening capability.
- [ ] Service worker, installable PWA shell and hard-refresh offline support.
- [ ] Participant self-service offline, full sync-centre conflict UI and eye-health offline capture.

## Security and operations

- [x] Backend authentication, CSRF handling, role/membership/duty authorization and account-state checks.
- [x] Zod validation, request IDs, safe errors, security headers, CORS allow-list and rate limits.
- [x] Prisma transactions, idempotency keys and request fingerprints on protected write paths.
- [x] PostgreSQL foreign keys, unique constraints, indexes and migration-backed audit immutability guards.
- [x] Structured local logging through `backend/utils/logger/logger.js`.
- [~] Cognito, OneMap, SES/SNS and Redis integrations; provider/configuration evidence is environment-dependent.
- [~] `pino` and `pino-http` are declared dependencies, but are not wired into the current runtime logger.
- [ ] Pino request logging integration.
- [ ] EC2 live deployment evidence, reverse-proxy evidence, backups, monitoring and restore evidence.
- [ ] Production artifact-signature enforcement; no runtime signature claim is made.

## Database evidence

- [x] PostgreSQL selected as the single persistence approach; Prisma schema and migrations are canonical.
- [x] Current migration SQL includes timestamp and append-only audit-log trigger functions.
- [~] `backend/stored_procedures.sql` supplies stored-procedure/function design evidence, but references legacy table names and is not a verified migration/deployment path.
- [ ] A human-run compatibility review and database execution evidence for the standalone procedure file.

## Cloud and optional scope

- [~] EC2 is the stated deployment target; repository scripts support a Node process but contain no live-instance proof.
- [~] Cognito is an implemented integration boundary when configured.
- [ ] Serverless compute, static object-storage hosting and managed secret-store deployment are not part of the verified submission architecture.
- [ ] AI/LLM clinical decisioning, microservice decomposition, event bus infrastructure and real-time external notifications beyond current provider adapters.

## Final-submission inputs

- [?] Verify team names, student identifiers, report date and course-specific formatting.
- [?] Complete and sign `docs/ai-transcripts/DECLARATION_TEMPLATE.md`.
- [?] Add only verified external AI/chat links to `docs/ai-transcripts/EXTERNAL_AI_CHAT_LINKS.md`.
- [?] Supply any required manual Lucidchart/Draw.io export or link; Mermaid sources in `docs/secure_coding/diagrams/` are the repository-side editable source.
- [?] Collect authorized EC2/PostgreSQL/Cognito/HTTPS screenshots and rehearse the demo; no such evidence is claimed here.
