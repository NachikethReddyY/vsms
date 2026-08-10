# VSMS component diagram

The component boundaries follow the current folder structure and request
path. Workers are backend processes over the same PostgreSQL state, not
separate serverless services.

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

    subgraph express[Node.js Express API]
        middleware[Security, auth, CSRF,<br/>rate-limit and validation middleware]
        routes[Versioned REST routes]
        controllers[Controllers]
        services[Domain services]
        workers[In-process workers<br/>reports, lifecycle, domain events]
        middleware --> routes --> controllers --> services
        workers --> services
    end

    prisma[Prisma client]
    postgres[(PostgreSQL)]
    cognito[Cognito provider]

    apiClient -->|HTTPS| middleware
    offline -->|sync screening batch| middleware
    services --> prisma --> postgres
    middleware -->|authorize/callback/JWKS| cognito
```

## Evidence

- Browser feature modules: `react-user-dashboard/src/features/`.
- API composition: `backend/app.js`, `backend/routes/`,
  `backend/controllers/`, `backend/services/`.
- Worker entry points: `backend/scripts/`.
- Persistence: `backend/prisma/prismaClient.js` and the Prisma schema.
