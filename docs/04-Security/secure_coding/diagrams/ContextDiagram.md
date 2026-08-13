# VSMS context diagram

This source shows the implemented application boundary and the AWS topology
recorded on 11 August 2026. Current availability is verified separately.

```mermaid
flowchart LR
    admin[Administrator]
    manager[Event manager]
    registration[Registration officer]
    screener[Screener]
    reviewer[Reviewer]

    client[Amplify-hosted React/Vite PWA<br/>service worker + encrypted IndexedDB]
    subgraph api[Node.js Express API process<br/>Nginx on EC2]
        middleware[Request context, security,<br/>auth, authorization and validation]
        routes[Versioned routes]
        controllers[Controllers]
        services[Domain Services]
        prisma[Prisma Client]
        middleware --> routes --> controllers --> services --> prisma
    end
    workers[Separate Node worker processes<br/>backend/scripts/*.js]
    db[(Private encrypted RDS PostgreSQL<br/>Prisma schema and migrations)]
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
- Optional providers are shown as dotted edges because the final acceptance
  replay must prove delivery.
- Deployment evidence: `docs/2026-08-11_aws-cloud-deployment-runbook.md`.
