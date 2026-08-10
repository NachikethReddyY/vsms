# VSMS component diagram

The component boundaries retain the browser/offline, Express, provider and
worker detail from this report while following the #105 request boundary:
versioned route and middleware → Controller → Service → Prisma. There is no
repository layer. Worker scripts are separate Node processes over the same
PostgreSQL state, not in-process Express workers or serverless services.

```mermaid
flowchart LR
    subgraph browser[Browser client]
        shell[React/Vite route shell]
        apiClient[API client + session state]
        offline[Offline sync provider]
        indexed[(Encrypted IndexedDB)]
        shell --> apiClient
        shell --> offline
        offline --> indexed
    end

    subgraph express[Node.js Express API process]
        middleware[Security, auth, CSRF,<br/>rate-limit and validation middleware]
        routes[Versioned REST routes]
        controllers[Controllers]
        services[Domain Services]
        middleware --> routes --> controllers --> services
    end

    workers[Separate Node worker processes<br/>backend/scripts/*.js<br/>reports, lifecycle, domain events]

    prisma[Prisma client]
    postgres[(PostgreSQL)]
    cognito[Cognito provider]

    apiClient -->|HTTPS| middleware
    offline -->|sync screening batch| middleware
    services --> prisma --> postgres
    workers -->|claim/process jobs and outbox rows| prisma
    middleware -->|authorize/callback/JWKS| cognito
```

## Evidence

- Browser feature modules: `react-user-dashboard/src/features/`.
- API composition: `backend/app.js`, `backend/routes/`,
  `backend/controllers/`, `backend/services/`.
- Worker entry points: `backend/scripts/`.
- Persistence: `backend/prisma/prismaClient.js` and the Prisma schema.
