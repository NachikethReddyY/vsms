# VSMS presentation Q&A

Use these as short answers, then show the linked evidence. Do not turn each
answer into another presentation segment.

## Why did you use PostgreSQL when the rubric asks for NoSQL design?

The rubric requires a defensible NoSQL design, not two production databases.
[`diagrams/NoSQLDesign.md`](diagrams/NoSQLDesign.md) evaluates a query-first
DynamoDB model with keys, indexes, consistency, capacity and security choices.
PostgreSQL is the smaller correct runtime because registration, queue movement,
screening, review and audit need relational integrity and multi-record
transactions, while reporting needs joins and percentile aggregates.

## What works offline?

The installed PWA shell and encrypted assigned pack support local capture for
all four core stations—visual acuity, refraction, colour vision and eye health—
plus custom schema-driven stations. Reconnection triggers idempotent sync and
retains actionable conflicts. Registration, review, referral, event
administration and reporting remain online-only, so we claim 100% of core
screening stations rather than 100% of the whole application.

## Does OWASP coverage mean VSMS is certified compliant?

No. The system has OWASP-aligned controls and a category-by-category evidence
matrix: event-scoped RBAC, validation, CSRF protection, rate limiting,
idempotency, encryption, secure headers and immutable audit history. Formal
assurance would additionally require an ASVS assessment, authenticated
penetration test, remediation evidence and independent review.

## How do you prove the 50%, 90% and 30% business targets?

The application records the required digital measurements, but a percentage
improvement needs a comparable paper baseline. We must test similar events with
the same participant complexity, station mix and staffing, then compare median
registration time, paper forms and completed journeys per staffed hour. Until
that pilot is complete, those three values remain targets, not achieved claims.

## Is the Operations Center really real-time?

It is near-real-time polling: authorized aggregates refresh every 15 seconds
and retain the last successful snapshot if refresh fails. This is enough for the
current event scale without adding a streaming platform. WebSockets or
server-sent events should be added only if measured operational latency shows a
need.

## How is the QR protected if scanning it grants access?

Each pass uses a high-entropy random token. The database stores a SHA-256 lookup
hash and an encrypted copy only for authorized re-rendering. Passes expire, can
be revoked or reissued, are event/registration scoped, and are invalidated when
the registration or event lifecycle closes. Audit records never contain the
raw token.

## What prevents duplicate or conflicting updates?

Service-owned transactions combine row locks, conditional updates, versions
and request fingerprints. Offline actions and QR mutations use idempotency keys;
replaying the same action returns its receipt, while reusing a key for different
content returns a conflict. PostgreSQL integration tests exercise concurrent
registration, route and QR transitions.

## Why use stored routines as well as Prisma services?

Prisma services own authorization, validation and orchestration. The four
registration routines protect the narrow invariants that must remain atomic at
the database boundary: capacity/waitlist allocation, check-in, cancellation
with QR revocation, and aggregate counts. Application roles receive only the
required `EXECUTE` privileges, and direct table mutation remains restricted.

## Is the production deployment highly available?

The repository contains a multi-instance/Multi-AZ target architecture and
separates process liveness from database readiness, but infrastructure code is
not proof of a deployed service-level objective. The team should show the
actual environment and monitoring evidence, or state that HA remains a target.

## What would you improve next?

First run a controlled pilot and capture the missing baseline evidence. Then
prioritize offline registration/check-in because arrival continuity has the
highest event impact. Complete ASVS-based assurance and production monitoring
before adding unrelated features.
