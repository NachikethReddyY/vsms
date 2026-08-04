# VSMS Event Operations

VSMS is a secure event-operations application for planning, publishing, running, and auditing community screening events. The repository contains an Express/Prisma API and a React/Vite dashboard.

## What is available

Public routes:

- `/` — product landing page
- landing-page sign-in actions — redirect to `/api/v1/auth/authorize` for managed Cognito login
- `/auth/callback` — completes the authorization-code + PKCE browser flow
- `/e/:eventId` — read-only public landing page for a non-draft event

Authenticated routes:

- `/events` — chronological upcoming and past event register
- `/events/new` — create an event
- `/events/:eventId` — event overview, attendees, station/manpower operations, lifecycle, export, and guarded deletion
- `/events/:eventId/edit` — full event, station-availability, shift, and staffing plan
- `/settings` — profile, appearance, and account-security entry points

The event lifecycle is `DRAFT → PUBLISHED → IN_PROGRESS → COMPLETED`, with cancellation available from non-terminal states. Mutations use role checks, optimistic concurrency, and immutable audit records.

## Prerequisites

- Node.js 24 or newer
- PostgreSQL 15 or newer
- pnpm 11

## Local setup

1. Install dependencies.

   ```bash
   pnpm --dir backend install
   pnpm --dir react-user-dashboard install
   ```

2. Create the backend environment file.

   ```bash
   cp backend/.env.example backend/.env
   ```

   Update `DATABASE_URL` and replace `JWT_ACCESS_SECRET`. Keep `PUBLIC_SIGNUP_ENABLED=false` unless this is a controlled environment where public staff account creation is intended.

3. Apply migrations, generate Prisma Client, and seed development data.

   ```bash
   pnpm --dir backend run prisma:migrate
   pnpm --dir backend exec prisma generate
   pnpm --dir backend run prisma:seed
   ```

4. Start both applications in separate terminals.

   ```bash
   pnpm --dir backend run dev
   pnpm --dir react-user-dashboard run dev
   ```

Open `https://localhost:5173`. The API is available at `https://localhost:5050`; non-production API documentation is at `https://localhost:5050/api-docs`. Plain HTTP is intentionally unavailable on both ports.

### Managed login

Configure the Cognito region, user pool, app client, hosted domain, redirect URI, and logout URI from `backend/.env.example`. Authorization code + PKCE is used. Browser credential tokens stay in Secure, HttpOnly cookies; JavaScript receives only the rotating CSRF token. Cognito group membership is intersected with locally assigned roles, so both provider and application authorization must agree.

## Verification

The backend test command derives a database name ending in `_test`, applies all migrations there, and refuses to prepare any other database.

```bash
pnpm --dir backend run prisma:validate
pnpm --dir backend run openapi:lint
pnpm --dir backend run contracts:check
pnpm --dir backend test
pnpm --dir backend run test:integration
pnpm --dir react-user-dashboard run lint
pnpm --dir react-user-dashboard run build
pnpm --dir react-user-dashboard run test:participants
pnpm --dir react-user-dashboard run test:queue
pnpm run check:https
```

The integration harness rewrites `DATABASE_URL` to an `_test` database and refuses any other suffix. Create that local test database with a role permitted to run migrations; never point the harness at production or a cloud database.

The Bruno collection is in `api-testing/bruno`. Select its `Local` environment after both applications are running. Generated result files are ignored because they may contain short-lived credentials.

## Deployment notes

- Run `pnpm --dir backend run prisma:migrate` before starting a new API release.
- Set `NODE_ENV=production`, a 32+ character `JWT_ACCESS_SECRET`, the production `DATABASE_URL`, and exact `CORS_ORIGINS`.
- Configure all Cognito values and use HTTPS redirect/logout URLs registered on the app client.
- Keep `PUBLIC_SIGNUP_ENABLED=false` for internet-facing deployments unless account creation is intentionally open.
- Terminate TLS at the trusted reverse proxy and set `TRUST_PROXY=true` only when that proxy is controlled.
- Build the frontend with `pnpm --dir react-user-dashboard run build`. Set `VITE_API_BASE_URL` when the API is not served at the frontend's expected origin.
- Configure the static host to rewrite application routes to `index.html`.

## Reference documentation

- [Event implementation report](docs/event-details-implementation-report.md)
- [Event delivery plan](design/event-details-plan.md)
- [Entity relationship model](erd.md)
- [OpenAPI contract](backend/docs/openapi.yaml)
