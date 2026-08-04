# VSMS Event Operations

VSMS is a secure event-operations application for planning, publishing, running, and auditing community screening events. The repository contains an Express/Prisma API and a React/Vite dashboard.

## What is available

Public routes:

- `/` — product landing page
- `/login` — staff sign-in
- `/signup` — staff registration; the API keeps registration disabled unless an administrator opts in

Authenticated routes:

- `/events` — graphical upcoming and past event cards
- `/events/new` — create an event
- `/events/:eventId` — event details and lifecycle actions
- `/events/:eventId/edit` — edit an event, including its banner

The event lifecycle is `DRAFT → PUBLISHED → IN_PROGRESS → COMPLETED`, with cancellation available from non-terminal states. Mutations use role checks, optimistic concurrency, and immutable audit records.

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 15 or newer
- pnpm 11.18.0 (via Corepack)

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

### Seeded development accounts

Cognito is temporarily disabled in development. After running the seed, use either local username/password pair:

| Username | Password | Access |
| --- | --- | --- |
| `seed.admin@cryptix.local` | `Demo-Only-Change-Me-2026!` | Administrator |
| `reviewer@vsms.local` | `Demo-Only-Change-Me-2026!` | Reviewer |

These credentials are development-only. Set `VSMS_DEMO_PASSWORD` before seeding to replace the shared password; production seeding refuses to run without an explicit value.

## Verification

The backend test command derives a database name ending in `_test`, applies all migrations there, and refuses to prepare any other database.

```bash
pnpm --dir backend prisma:validate
pnpm --dir backend openapi:lint
pnpm --dir backend contracts:check
pnpm --dir backend test
pnpm --dir react-user-dashboard lint
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
- [Entity relationship model](erd.md)
- [OpenAPI contract](backend/docs/openapi.yaml)



Manually remove the event
