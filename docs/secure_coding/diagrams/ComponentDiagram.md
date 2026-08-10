# VSMS component diagram

This diagram reflects the repository implementation, not a proposed cloud deployment. The API has no repository layer: Prisma is the data-access client used by domain services.

```mermaid
flowchart LR
  Web[React dashboard / browser] -->|HTTPS API request| Express[Express application]
  Express --> MW[Request context, security, CSRF, auth, authorization, validation]
  MW --> Routes[Versioned route modules]
  Routes --> Controllers[Controllers]
  Controllers --> Services[Domain services]
  Services --> Prisma[Prisma Client]
  Prisma --> DB[(PostgreSQL)]
  Services -. configured managed login / identity sync .-> Cognito[Amazon Cognito]
  Services -. configured provider callbacks / delivery .-> Providers[Configured external providers]
```

Controllers handle HTTP input and response mapping. Services own business rules, authorization-sensitive resource decisions, audit writes, and transactions. `backend/docs/request-architecture.md` records the concrete boundary and examples.
