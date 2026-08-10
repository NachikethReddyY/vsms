# VSMS context diagram

This source retains the browser roles, offline storage, configured providers
and EC2 target while exposing the #105 request boundary inside the Express
process: versioned route and middleware → Controller → Service → Prisma. It
does not show proposed alternatives or a live deployment.

```mermaid
flowchart LR
    admin[Administrator]
    manager[Event manager]
    registration[Registration officer]
    screener[Screener]
    reviewer[Reviewer]

    client[React/Vite dashboard<br/>browser + encrypted IndexedDB]
    subgraph api[Node.js Express API process<br/>EC2 deployment target]
        middleware[Request context, security,<br/>auth, authorization and validation]
        routes[Versioned routes]
        controllers[Controllers]
        services[Domain Services]
        prisma[Prisma Client]
        middleware --> routes --> controllers --> services --> prisma
    end
    workers[Separate Node worker processes<br/>backend/scripts/*.js]
    db[(PostgreSQL<br/>Prisma schema and migrations)]
    cognito[Cognito<br/>authorization-code + PKCE]
    onemap[OneMap<br/>optional configured provider]
    providers[SES/SNS<br/>optional configured providers]

    admin --> client
    manager --> client
    registration --> client
    screener --> client
    reviewer --> client
    client -->|HTTPS API requests| api
    client -->|login redirect/callback| cognito
    api -->|token exchange/JWKS| cognito
    prisma -->|transactions and queries| db
    workers -->|job/outbox access| prisma
    services -.->|configured location lookup| onemap
    services -.->|configured notification delivery| providers
```

## Evidence

- Client: `react-user-dashboard/src/` and `vite.config.ts`.
- API: `backend/app.js`, `backend/server.js`, `backend/routes/`.
- Database: `backend/prisma/schema.prisma` and `backend/prisma/migrations/`.
- Cognito: `backend/utils/cognitoClient.js` and `infrastructure/cognito.yaml`.
- Optional providers are shown as dotted edges because repository source does
  not prove external availability or delivery.
