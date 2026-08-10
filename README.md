# VSMS Event Operations

VSMS is a secure event-operations application for planning, publishing, running, and auditing community screening events. The repository contains an Express/Prisma API and a React/Vite dashboard.

## What is available

Public routes:

- `/` — product landing page
- sign-in actions — redirect to `/api/v1/auth/authorize` for managed Cognito login
- `/auth/callback` — completes the authorization-code + PKCE browser flow
- `/e/:eventId` — read-only public landing page for a non-draft event

Authenticated routes:

- `/events` — chronological upcoming and past event register
- `/events/new` — create an event
- `/events/:eventId` — event overview, event-scoped operations, memberships, duties, completed-event analytics, report exports, and guarded deletion
- `/events/:eventId/edit` — full event, station-availability, shift, and staffing plan
- `/events/:eventId/memberships` and staffing panels — membership-first staff access with role assignments separate from duties
- `/admin/accounts` — administrator account approval, suspension, reactivation, session revocation, deprovisioning, and lifecycle-email resend
- `/settings` — safe profile editing, account state, memberships, duties, and account-security entry points
- account-state pages — pending, rejected, suspended, disabled, unassigned, forbidden, and not-found guidance

The event lifecycle is `DRAFT → PUBLISHED → IN_PROGRESS → COMPLETED`, with cancellation available from non-terminal states. Mutations use role checks, optimistic concurrency, and immutable audit records.

## Prerequisites

- Node.js 24 or newer
- PostgreSQL 15 or newer
- pnpm 11.20.0 (via Corepack)

## Local setup

1. Install dependencies.

   ```bash
   corepack enable
   pnpm --dir backend install --frozen-lockfile
   pnpm --dir react-user-dashboard install --frozen-lockfile
   ```

2. Create the backend environment file.

   ```bash
   cp backend/.env.example backend/.env
   ```

   Update `DATABASE_URL` and replace `JWT_ACCESS_SECRET`. Keep `PUBLIC_SIGNUP_ENABLED=false` unless this is a controlled environment where public staff account creation is intended.

3. Apply migrations, generate Prisma Client, and seed development data.

   ```bash
   pnpm --dir backend prisma:migrate
   pnpm --dir backend exec prisma generate
   pnpm --dir backend prisma:seed
   ```

4. Start both applications in separate terminals.

   ```bash
   pnpm --dir backend dev
   pnpm --dir react-user-dashboard dev
   ```

Open `https://localhost:5173`. The API is available at `https://localhost:5050`; non-production API documentation is at `https://localhost:5050/api-docs`. Plain HTTP is intentionally unavailable on both ports.

### Managed login

Configure the Cognito region, user pool, app client, hosted domain, redirect URI, and logout URI from `backend/.env.example`. Authorization code + PKCE is used. Browser credential tokens and the CSRF token stay in Secure cookies, with auth cookies marked HttpOnly. JavaScript learns session state from JSON fields such as `user`, `expiresIn`, and `sessionExpiresIn`; it does not receive access tokens, refresh tokens, or CSRF values from `/api/v1/auth/refresh`. Cognito owns refresh-token issuance, rotation, password changes, MFA, recovery, and revocation. The local `/api/v1/auth/refresh` endpoint exchanges the Cognito refresh cookie for new auth/CSRF cookies and never exposes a refresh token to JavaScript. Cognito group membership is intersected with locally assigned roles, so both provider and application authorization must agree.

## Verification

The backend test command derives a database name ending in `_test`, applies all migrations there, and refuses to prepare any other database.

```bash
pnpm --dir backend prisma:validate
pnpm --dir backend openapi:lint
pnpm --dir backend contracts:check
pnpm --dir backend test
pnpm --dir backend test:integration
pnpm --dir react-user-dashboard lint
pnpm --dir react-user-dashboard test
pnpm --dir react-user-dashboard build
pnpm check:https
```

The Bruno collection is in `api-testing/bruno`. Select its `Local` environment after both applications are running. Generated result files are ignored because they may contain short-lived credentials.

## Deployment notes

- Run `pnpm --dir backend prisma:migrate` before starting a new API release.
- Set `NODE_ENV=production`, a 32+ character `JWT_ACCESS_SECRET`, the production `DATABASE_URL`, exact `CORS_ORIGINS`, and a bare HTTPS `PUBLIC_APP_ORIGIN` (used in QR payloads).
- Keep `PUBLIC_SIGNUP_ENABLED=false` for internet-facing deployments unless account creation is intentionally open.
- Terminate TLS at the trusted reverse proxy and set `TRUST_PROXY=true` only when that proxy is controlled.
- Build the frontend with `pnpm --dir react-user-dashboard build`. Set `VITE_API_BASE_URL` when the API is not served at the frontend's expected origin.
- Configure the static host to rewrite application routes to `index.html`.

## Reference documentation

- [Event implementation report](docs/event-details-implementation-report.md)
- [Event delivery plan](design/event-details-plan.md)
- [Live acceptance kit](docs/live-acceptance.md)
- [Entity relationship model](erd.md)
- [OpenAPI contract](backend/docs/openapi.yaml)
