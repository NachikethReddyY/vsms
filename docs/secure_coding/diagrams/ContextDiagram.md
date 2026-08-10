# VSMS context diagram

This source shows the current repository boundary: browser client, Express
API, PostgreSQL and Cognito. It does not show proposed alternatives or a live
deployment.

```mermaid
flowchart LR
    admin[Administrator]
    manager[Event manager]
    registration[Registration officer]
    screener[Screener]
    reviewer[Reviewer]

    client[React/Vite dashboard<br/>browser + encrypted IndexedDB]
    api[Node.js Express API<br/>EC2 deployment target]
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
    api -->|Prisma transactions and queries| db
    api -.->|configured location lookup| onemap
    api -.->|configured notification delivery| providers
```

## Evidence

- Client: `react-user-dashboard/src/` and `vite.config.ts`.
- API: `backend/app.js`, `backend/server.js`, `backend/routes/`.
- Database: `backend/prisma/schema.prisma` and `backend/prisma/migrations/`.
- Cognito: `backend/utils/cognitoClient.js` and `infrastructure/cognito.yaml`.
- Optional providers are shown as dotted edges because repository source does
  not prove external availability or delivery.
