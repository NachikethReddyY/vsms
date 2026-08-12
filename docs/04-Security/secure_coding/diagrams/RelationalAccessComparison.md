# Persistence access comparison

The project brief presents PostgreSQL and a query-first NoSQL model as
alternatives. The current repository selects PostgreSQL; the comparison below
records why the report uses relational access and does not imply a second
database implementation.

```mermaid
flowchart TB
    requirement[VSMS access needs<br/>event membership, queue state,<br/>screening results, auditability]

    subgraph relational[Selected: PostgreSQL + Prisma]
        rmodel[Normalized related models<br/>foreign keys and unique constraints]
        rquery[Prisma relations + PostgreSQL joins/aggregates]
        rtx[Transactions and migration-backed triggers]
        rmodel --> rquery --> rtx
    end

    subgraph nosql[Brief alternative: query-first NoSQL]
        nmodel[Partition/sort-key item collections]
        nquery[Designed access patterns and denormalized reads]
        nconsistency[Application-managed cross-item consistency]
        nmodel --> nquery --> nconsistency
    end

    requirement --> relational
    requirement -.->|alternative only| nosql
```

Repository evidence for the selected path is
`backend/prisma/schema.prisma`, `backend/prisma/migrations/` and the service
queries. No NoSQL table or handler is part of the current runtime contract.
