# VSMS deployment diagram

This is the topology recorded in the 11 August 2026 deployment runbook. It is
historical deployment evidence; current availability is verified separately.

```mermaid
flowchart LR
    tablet[Staff tablet/browser<br/>installable React/Vite PWA<br/>service worker + encrypted IndexedDB]
    amplify[AWS Amplify managed hosting<br/>same-origin /api/* proxy]

    subgraph ec2[EC2 t3.small host]
        proxy[Nginx + Let's Encrypt<br/>HTTPS reverse proxy]
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

    postgres[(Private encrypted RDS<br/>PostgreSQL 16.14, Single-AZ<br/>7-day backups)]
    secret[Secrets Manager<br/>RDS-owned master credential]
    cognito[Cognito<br/>authorization code + PKCE]
    onemap[OneMap / SES / SNS<br/>only when configured]

    tablet -->|HTTPS| amplify -->|HTTPS /api/*| proxy --> api
    tablet -->|Cognito redirect| cognito
    api -->|token exchange/JWKS| cognito
    prisma -->|SQL| postgres
    secret -.->|credential source| postgres
    api -.-> onemap
```

## Deployment limits

- The EC2 API and separate workers are supervised by systemd; RDS accepts port
  5432 only from the EC2 security group.
- Amplify serves the PWA and proxies `/api/*` so secure OAuth cookies remain
  same-origin.
- An encrypted RDS snapshot and automated backups existed at deployment; the
  repeatable recovery workflow separately proves logical restore integrity.
- `backend/docker-compose.yml` provides local Redis support for rate limiting;
  it is not proof of a deployed shared Redis service.
- Single-AZ RDS and one EC2 host are documented availability limits.
