# Event Lifecycle and Details — Implementation Report

Issue: [#7 — Event lifecycle and details form](https://github.com/soc-DBSP/react-nodejs-project2-cryptix/issues/7)

Branch: `nachikethreddyy/event-details`

## Purpose

This report is updated alongside implementation. It records what was coded,
why each flow exists, which files informed the work, schema/ERD changes, test
evidence, security findings, Bruno API results, and remaining deployment risks.

## Required delivery order

1. Secure identity, sessions, transport, and authorization.
2. Prisma schema, migrations, event domain, audit trail, and seed data.
3. Express REST API, OpenAPI contract, and backend verification.
4. Bruno collection execution and saved machine-readable results.
5. Tablet/desktop React interface.
6. End-to-end, accessibility, dependency, and OWASP-oriented verification.

Frontend implementation is not allowed to precede a passing backend contract
and backend test suite.

## Files consulted

These files directly informed architecture, security, data design, interface
design, or compatibility decisions:

| File | Why it was used |
|---|---|
| `docs/design.md` | Current product design system, responsive shell, visual tokens, accessibility, wording, and offline behavior. |
| `design/event-details-plan.md` | Approved preflight architecture and implementation sequence. |
| `erd.md` | Current and proposed database models, relations, enums, and unresolved references. |
| `backend/prisma/schema.prisma` | Canonical current Prisma schema and source for migration design. |
| `backend/prisma/migrations/*` | Existing database history, including removed identity/registration tables and current event models. |
| `backend/db/init.sql` | Identified the incompatible legacy integer/plaintext users table; it will not remain a runtime schema source. |
| `backend/server.js` | Existing Express bootstrap, CORS, Swagger, routing, and transport behavior. |
| `backend/controllers/authController.js` | Identified plaintext password comparison and fixed mock tokens. |
| `backend/models/userModel.js` | Identified calls to a nonexistent Prisma `users` model and unrestricted projections. |
| `backend/routes/authRoutes.js` | Existing public login/signup attack surface. |
| `backend/routes/userRoutes.js` | Identified the unauthenticated user-list route. |
| `backend/utils/jwt.js` | Existing unconstrained JWT claims/signing behavior. |
| `backend/utils/verifyToken.js` | Existing bearer parsing and verification boundary. |
| `backend/middlewares/validate.js` | Existing partial Zod-compatible middleware pattern. |
| `backend/docs/openapi.yaml` | Existing HTTP API contract and insecure HTTP/token examples to replace. |
| `react-user-dashboard/src/App.tsx` | Current route structure. |
| `react-user-dashboard/src/components/DashboardPage.tsx` | Current placeholder application surface. |
| `react-user-dashboard/src/index.css` | Current Tailwind/global CSS baseline. |
| `react-user-dashboard/src/utils/apiClient.ts` | Identified hard-coded HTTP/example endpoints and local-storage tokens. |
| `react-user-dashboard/vite.config.ts` | Existing local HTTPS certificate configuration and current config defect. |
| `docs/ACCESSIBILITY.md` | Existing accessibility guidance. |
| `docs/COMPONENTS.md` | Existing component conventions. |
| `docs/CONTENT.md` | Existing content and clinical-language guidance. |
| `docs/MOTION.md` | Existing motion and reduced-motion expectations. |

## Architecture decisions and rationale

### Identity is safe but temporary

The supplied platform ERD is now the target domain reference. It separates
`User`, `User_Credentials`, roles, and permissions, while this branch previously
had no usable identity table. Issue #7 therefore uses a temporary UUID `User`
with unique username/email, bcrypt credentials, role/status, and lock counters.
The migration stops on populated actor tables instead of guessing identities.
`erd.md` documents the later reconciliation explicitly.

### Refresh sessions are stateful

Rotating refresh tokens cannot safely detect replay with stateless JWTs alone.
Each high-entropy refresh token is hashed in `RefreshSession`; rotation shares
an indexed family ID, and replay revokes the family transactionally.

### Event lifecycle uses command endpoints

Publish, start, complete, and cancel are explicit commands instead of generic
status patches. This makes valid transitions, permissions, audit actions, API
documentation, and tests unambiguous.

### Event and shifts form one versioned aggregate

Create accepts bounded shifts and PATCH submits the desired planned shift set
with an event version. Event, shifts, version increment, and one audit row are
committed atomically. A stale version returns `409` and changes nothing.

### Audit data is immutable and redacted

Only successful domain mutations enter `EventAuditLog`. Rejected security
events use separate redacted logs. Database triggers and runtime privileges
prevent API-side audit update/delete, and snapshots contain allowlisted fields.

### Capacity scope is honest

Issue #7 validates event capacity as configuration (`1..100000`). Existing
migrations removed the registration model, so this feature does not fabricate
occupancy counts or claim transactional overbooking protection that cannot yet
be implemented.

## Implementation ledger

| Stage | Change | Why | Status |
|---|---|---|---|
| Planning | Created and reviewed the implementation plan and ERD. | Lock architecture before touching security-critical code. | Complete |
| Planning | Created an ignored local HTML plan viewer. | Make the sequence and security gate inspectable without adding generated presentation output to Git. | Complete |
| Tooling | Installed Bruno CLI 3.5.2; saved `.bru`, JSON OpenCollection, YAML OpenCollection, and redacted YAML results. | Reproducible API checks in the requested tool without committing token-bearing raw reports. | Complete |
| Backend | Temporary username identity, opt-in staff registration, and rotating secure-cookie sessions. | Keep internet-facing signup closed by default while preserving HTTPS, bcrypt, CSRF, replay detection, and live role/status checks. | Complete |
| Backend | Versioned event lifecycle API and immutable audit trail. | Core issue #7 behavior with atomic writes, authorization, and explicit transitions. | Complete |
| Contract | OpenAPI lint, generated React types, and drift check. | Prevent runtime/frontend contract divergence. | Complete |
| Frontend | Public landing page, graphical event list, editable event banners, creation, detail, lifecycle controls, shell, and responsive states. | A coherent public-to-operations journey with persisted event artwork and mobile/desktop coverage. | Complete |
| Review | Engineering, security, and design re-review. | Confirm the implementation, documentation, and release boundary before publication. | Complete |

## Bruno API testing

Bruno CLI supports `.bru` collections and JSON/JUnit/HTML reporters. It does not
provide a native YAML result reporter. The implementation will therefore:

- keep the executable Bruno `.bru` collection in `api-testing/bruno/`;
- keep an OpenCollection YAML export in `api-testing/event-api.collection.yml`;
- generate Bruno JSON/JUnit/HTML reports;
- keep generated reports local and ignored because they can contain cookies,
  tokens, or response headers.

## Test storage

Automated backend test source is stored in `backend/tests/` (organised into
`unit/`, `integration/`, and `security/`) and committed so a clean clone can run
the same verification. Coverage, browser, and Bruno result artifacts remain
ignored because they are generated and may contain credentials.

## Security verification status

The original plaintext/mock authentication, public user enumeration,
local-storage tokens, unconstrained JWT helper, wildcard CORS, missing limits,
and hard-coded HTTP API were removed or replaced. Backend production
dependencies and frontend production dependencies both audit at zero known
vulnerabilities. Bruno remains isolated as development tooling; raw reports are
ignored because successful login responses contain access tokens.

Production still requires operational evidence: an HTTPS reverse proxy, private
upstream network policy, separate runtime/migration database credentials, real
secret management, monitoring, backups, and the platform identity reconciliation
described in `erd.md`. The implementation does not claim that code alone makes
a deployed system invulnerable.

## Evidence log

| Check | Result | Evidence |
|---|---|---|
| Prisma validation/migrations | Pass; seven migrations, including guarded identity/event migration, temporary username migration, and persisted event banner selection | `pnpm run prisma:validate`, `pnpm run prisma:migrate` |
| Seed | Pass; `admin`, `manager`, and `staff` usernames and five lifecycle states | `pnpm run prisma:seed` |
| Backend integration | Pass, 2 files / 9 tests; includes concurrent refresh reuse revoking the winning family, disabled-by-default signup, and persisted banner updates on active and completed events | `pnpm test` |
| OpenAPI | Pass; redirect-only authorization produces one expected 2xx warning | `pnpm run openapi:lint` |
| Contract drift | Pass | `pnpm run contracts:check` |
| Frontend | Production build pass; ESLint pass with zero warnings/errors | `pnpm run build && pnpm run lint` |
| Runtime dependencies | Backend 0; frontend 0 | `pnpm audit --prod` in both packages |
| Bruno lifecycle | Pass, 13/13 requests and tests | Local generated Bruno report |
| Bruno cookie session | Pass, 3/3 login/refresh/logout requests and tests | Local generated Bruno report |
| HTTPS | Trusted-CA curl 200; HSTS, CSP, frame, referrer, MIME and request-ID headers present; SAN includes localhost and 127.0.0.1 | `curl --cacert ... https://127.0.0.1:5050/health` |
| Browser responsive | Public landing page inspected at 390×844 and 1440×900; login, event list, creation flow, and detail/audit view inspected at earlier desktop/tablet breakpoints; no document horizontal overflow observed | T3 collaborative browser snapshots |

## Highlighted implementation files

| Area | Files | What was coded |
|---|---|---|
| Data/ERD | `backend/prisma/schema.prisma`, both `20260722...` migrations, `backend/prisma/seed.js`, `erd.md` | Event version/timezone, immutable audit, actor relations, refresh sessions, temporary username, lifecycle fixtures, supplied 30-table reference map |
| Backend boundary | `backend/app.js`, `backend/server.js`, `backend/config/env.js`, `backend/middlewares/*` | HTTPS, private production bind, headers, CORS allowlist, limits, request IDs, problem errors, JWT auth, live role/status checks, CSRF |
| Authentication | `backend/services/authService.js`, `backend/utils/tokens.js`, `backend/utils/security.js` | Bcrypt login, username/email lookup, short JWTs, rotating hashed cookie sessions, family revocation, atomic failure counts |
| Event domain | `backend/services/eventService.js`, `backend/schemas/eventSchemas.js`, `backend/routes/eventRoutes.js`, `backend/controllers/eventController.js` | CRUD, authorization, lifecycle commands, signed cursors, version conflicts, shift aggregate, audit transactions |
| API contract | `backend/docs/openapi.yaml`, `backend/scripts/check-contract.js`, `react-user-dashboard/src/generated/api.ts` | Complete REST contract, lint, generated types, deterministic drift gate |
| Frontend | `src/auth/*`, `src/utils/apiClient.ts`, `src/components/LandingPage.tsx`, `src/components/AppShell.tsx`, `src/features/events/*`, `src/index.css` | Public landing page, login with retained cookie refresh, memory tokens, graphical event list, persisted banner picker, detail/edit flow, shell, and responsive design-system styling |
| API verification | `api-testing/bruno/`, `api-testing/event-api.collection.json`, `api-testing/event-api.collection.yml` | Executable collection and portable exports; generated result files stay local |
| TLS | `vite.config.ts`, `backend/.env.example` | HTTPS-only local development with developer-generated, untracked certificates and fail-closed startup |

## Test and artifact storage policy

Backend integration tests are committed and runnable from a clean clone. Raw
Bruno and coverage output is ignored to avoid committing tokens, cookies, or
machine-specific evidence. Local TLS certificates and private keys are also
ignored and must be generated per developer machine.
