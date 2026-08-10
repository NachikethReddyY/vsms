# VSMS request sequence

The normal online request path is implemented as follows. Offline browser storage and retry UI are client concerns; the server-side sync endpoint is an event-scoped service request in the same flow.

```mermaid
sequenceDiagram
  actor Staff
  participant Client as Browser / PWA
  participant App as Express app
  participant Guard as Auth, authorization, validation middleware
  participant Route as Versioned route
  participant Controller
  participant Service as Domain service
  participant Prisma as Prisma Client
  participant DB as PostgreSQL

  Staff->>Client: submit operation
  Client->>App: HTTPS request
  App->>Guard: context, parser, CSRF, identity, role/event checks
  Guard->>Route: validated request
  Route->>Controller: handler
  Controller->>Service: validated values + actor/context
  Service->>Prisma: query or transaction
  Prisma->>DB: SQL
  DB-->>Prisma: rows / commit
  Prisma-->>Service: domain result
  Service-->>Controller: result or controlled error
  Controller-->>Client: mapped HTTP response
```

For managed login, the authentication controller additionally exchanges the authorization code and verifies Cognito tokens before calling the account service to persist local session state. Cognito is not in ordinary event-data requests. No repository component exists between services and Prisma.
