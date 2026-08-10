# VSMS deployment diagram

This is the repository-supported target topology. The EC2 node and reverse
proxy are deployment targets/prerequisites; this repository contains no live
instance, security-group or certificate evidence. The Express request path
follows the #105 route → Controller → Service → Prisma boundary.

```mermaid
flowchart LR
    tablet[Staff tablet/browser<br/>React/Vite dashboard<br/>encrypted IndexedDB]
    proxy[Operator-managed HTTPS<br/>reverse proxy / TLS boundary]

    subgraph ec2[EC2 host — deployment target]
        api[Node.js Express API process]
        middleware[Request context, security,<br/>auth, authorization and validation]
        routes[Versioned routes]
        controllers[Controllers]
        services[Domain Services]
        workers[Separate Node worker processes<br/>backend/scripts/*.js]
        prisma[Prisma Client]
        api --> middleware --> routes --> controllers --> services --> prisma
        workers -->|claim/process jobs and outbox rows| prisma
    end

    postgres[(PostgreSQL<br/>DATABASE_URL target)]
    cognito[Cognito<br/>external identity boundary]
    onemap[OneMap / SES / SNS<br/>only when configured]

    tablet -->|HTTPS| proxy --> api
    tablet -->|Cognito redirect| cognito
    api -->|token exchange/JWKS| cognito
    prisma -->|SQL| postgres
    api -.-> onemap
```

## Deployment limits

- `backend/server.js` can start the API; `README.md` documents production
  environment and reverse-proxy prerequisites.
- PostgreSQL provisioning, network policy, backups, monitoring, process
  supervision and recovery are operational work outside the repository.
- The browser offline pack is an application feature, not a service-worker
  cache. A hard refresh while offline is not claimed to work.
- No serverless, static object-storage, or managed secret-store node is shown
  because none is verified as the current deployment architecture.
