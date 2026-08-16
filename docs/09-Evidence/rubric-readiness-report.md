# VSMS rubric readiness report

Date: 13 August 2026

This is an evidence-based readiness estimate, not a guaranteed client grade. It scores only work that can be demonstrated from the repository or the validated application workflow.

## Projected score

| Component | Weight | Readiness score | Evidence and remaining gap |
| --- | ---: | ---: | --- |
| Requirements analysis | 5 | 4.5 | BR-01 to BR-08 are mapped to repeatable evidence. The three operational improvement targets still require a measured paper-workflow baseline. |
| Architecture design | 10 | 9.0 | The system separates React/PWA, Express services, PostgreSQL, Cognito, Redis coordination and an infrastructure-as-code production target with a gated release workflow. The presentation must distinguish implemented automation from the historical lab deployment and a currently verified production service. |
| Database design (NoSQL) | 5 | 4.0 | The DynamoDB alternative now specifies access patterns, keys, consistency, capacity and security, with a reasoned decision to retain PostgreSQL for clinical transactions. It is a design exercise rather than a deployed secondary datastore. |
| API design | 10 | 9.0 | Versioned OpenAPI, generated TypeScript parity, strict validation, RBAC, idempotency and documented error contracts are checked in CI. |
| Security design | 20 | 18.0 | The OWASP Top 10:2025 matrix links every category to controls and repeatable checks. This demonstrates control coverage, not formal OWASP certification or a completed independent penetration test. |
| Implementation | 20 | 19.5 | The complete journey includes four configurable screening stations, queue progression, clinical review, referrals, reporting and offline synchronization. Four documented registration routines now enforce capacity, waitlist, QR revocation, check-in and aggregate invariants at the database boundary. |
| Testing | 10 | 9.5 | The current repository validation passes 48 availability/deployment tests, Prisma validation, OpenAPI/client parity, API collection checks, frontend lint and the production build. Earlier Docker evidence records 427 backend and 92 frontend tests. Deployment contract tests verify a recovery checkpoint, one-off migration task, clean migration-status gate, credential separation, readiness gating and rollback evidence. Live AWS/Cognito acceptance must still be recaptured for the final deployed revision. |
| Bonus features | 10 | 8.5 | Encrypted offline PWA capture, safe synchronization, immutable audit history, QR lifecycle controls, performance fixtures and availability infrastructure provide meaningful extension beyond CRUD. |
| Presentation and Q&A | 10 | 9.0 | The demonstration deck matches the four-station product and includes an evidence scorecard; `docs/04-Security/secure_coding/presentation-q-and-a.md` gives concise, evidence-backed answers for the highest-risk questions. |
| **Projected total** | **100** | **91.0** | **High-distinction readiness if the live evidence and operational measurements are presented honestly.** |

## Implemented in this improvement

1. Promoted Eye Health from review-only data to a complete fourth station workflow.
2. Added server-side Eye Health evaluation, flagged-result acknowledgement, idempotent save, audit logging and automatic queue progression.
3. Added Eye Health to event templates, station import, seed/demo data and a forward Prisma migration.
4. Added encrypted offline capture and safe synchronization for Eye Health, giving all four core screening stations the same offline path.
5. Added a machine-checked business-requirement and business-objective evidence contract.
6. Added an OWASP Top 10:2025 verification matrix with residual risks and repeatable proof commands.
7. Expanded the NoSQL design into a defensible DynamoDB model and documented why the transactional clinical system remains on PostgreSQL.
8. Updated acceptance evidence, report content and the demonstration deck so claims match implemented behavior.
9. Made the availability infrastructure tests portable across LF and CRLF checkouts.
10. Hardened the four registration stored routines, moved QR revocation into database-owned cancellation, and added fresh-database concurrency plus PostgreSQL catalog evidence.
11. Added a presentation Q&A sheet covering NoSQL selection, offline scope, OWASP assurance, QR security, concurrency, stored routines and deployment limits.
12. Added a controlled GitHub Actions release pipeline that promotes one scanned
    image digest through staging and production only after a verified RDS
    snapshot, one privileged migration task, clean Prisma migration status,
    readiness checks and smoke tests.
13. Separated build, deployment, migration and verification OIDC roles, kept API
    tasks on `vsms_runtime`, retained the previous application/frontend release,
    and documented forward-fix and isolated-restore procedures.

## Evidence that must still be collected

- Time the same registration workflow on paper and in VSMS with the same participant-data complexity.
- Count paper forms and manual transcription steps before and after adoption.
- Run equivalent event sessions to measure participants completed per hour.
- Capture a sanitized live browser/Cognito replay on the exact release commit.
- Conduct an independent penetration test if formal security assurance is required.

Until those activities are complete, the 50% registration-time reduction, 90% paperwork reduction and 30% throughput increase remain targets rather than achieved outcomes.
