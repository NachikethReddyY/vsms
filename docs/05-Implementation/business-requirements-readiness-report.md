# VSMS business requirements readiness report

**Assessment date:** 13 August 2026
**Scope:** Current React, Express and PostgreSQL implementation, including the business-readiness increment on `feat/business-readiness-evidence`.

## Executive summary

VSMS substantially implements BR-01, BR-02, BR-03, BR-04, BR-06, BR-07 and BR-08. BR-05 is implemented for supported screening-station capture, including encrypted local storage, automatic retry and idempotent server synchronization, but it is not yet complete for registration, event administration, clinical review, referrals or reporting while disconnected.

This increment closes an important evidence gap. The application previously provided the operational features but did not record enough objective data to prove the stated business outcomes. VSMS now measures median registration duration, paperless usage, queue waiting percentiles, completed station visits per hour, offline-capable station coverage, synchronization success and same-day report generation. Event completion also automatically queues an audited overview PDF.

Security controls are strongly aligned with the OWASP Top 10, but the report should describe this as **OWASP-aligned controls**, not formal OWASP compliance. A compliance claim requires a documented control assessment, dependency and configuration evidence, penetration testing and remediation records.

## Business objective assessment

| Objective | Target | Current evidence | Status |
| --- | ---: | --- | --- |
| Reduce registration time | 50% reduction | Median time from opening the registration workflow to successful event registration is recorded and displayed. A pre-VSMS paper baseline is still required for comparison. | Measurable; target not yet proven |
| Reduce paperwork | 90% reduction | Each registration records whether a paper exception was used. The Operations Center displays the paperless percentage. | Measurable; validate against live-event data |
| Improve screening throughput | 30% increase | Completed station visits per operational event hour, queue wait p50/p90 and service-time p50/p90 are calculated. A historical baseline is still required. | Measurable; target not yet proven |
| Support offline operation | 100% coverage | Encrypted offline capture and automatic synchronization support visual acuity, refraction, colour vision and custom screening stations. Coverage is displayed per event. Other workflows remain online-only. | Partially fulfilled |
| Improve reporting speed | Same-day reporting | Completing an event now queues an overview PDF automatically. The dashboard records generation time and whether it was generated on the event's local calendar day. | Implemented; depends on worker availability |
| Improve security posture | OWASP compliance | Backend RBAC, validation, audit logging, rate limiting, secure headers, MFA integration, encrypted offline storage and application-level NRIC encryption are present. | Strong alignment; formal assurance outstanding |
| Improve participant tracking | Real-time visibility | Queue, station completion, referrals and synchronization state are refreshed every 15 seconds in the Operations Center. | Fulfilled as near-real-time visibility |

The percentage-improvement objectives cannot be honestly proven from a single post-implementation dataset. The team should record a paper-process baseline using the same definitions, then compare like-for-like events of similar size and station mix.

## Business requirement traceability

| Requirement | Implemented capability and evidence | Assessment |
| --- | --- | --- |
| BR-01 Event Management | Administrators and authorized event managers can create events, configure versioned stations, manage event days and shifts, and assign eligible staff. Publishing is blocked until an active station and staff assignment exist. | Fulfilled |
| BR-02 Participant Registration | Electronic participant creation and event registration, participant search, secure QR generation and check-in are implemented. New NRIC values are encrypted with AES-256-GCM and searched through an HMAC blind index; API responses exclude plaintext and cryptographic storage fields. | Fulfilled |
| BR-03 Participant Tracking | Route steps, queue entries, station hand-offs, public QR status and the Operations Center expose progress, queue state and station completion. | Fulfilled |
| BR-04 Screening Operations | Screeners record and update supported station results through validated, event-scoped services. Rules create preliminary flags, acknowledgements are enforced and reviewers make the final clinical decision. | Fulfilled |
| BR-05 Offline Operation | The PWA stores supported screening snapshots and outbox mutations in encrypted IndexedDB, synchronizes automatically after reconnection and uses idempotency keys to prevent duplicates. Whole-application offline operation is not yet available. | Partially fulfilled |
| BR-06 Security and Compliance | Cognito/MFA integration, event-scoped RBAC, server validation, audit logs, secure QR tokens, encrypted offline records, encrypted NRIC storage, key rotation guidance and security tests are present. | Substantially fulfilled; independent assurance remains |
| BR-07 Reporting and Analytics | Overview, operations, clinical and referral aggregate datasets can be generated as PDF or CSV for completed events. Small clinical cells are suppressed. An overview PDF is now queued automatically on completion. | Fulfilled |
| BR-08 Operational Dashboard | Event status, completion, queues, staffing, referrals, sync health and business-objective evidence are shown in one 15-second-refresh operational view. | Fulfilled |

## Changes implemented in this increment

### 1. Business-outcome evidence

Registration now accepts a bounded client workflow-start timestamp and an explicit paper-exception declaration. The database stores `workflowStartedAt`, `paperFormUsed` and a required reason when a paper exception is declared. This design measures the outcome without adding participant clinical data to analytics or audit records.

The Operations Center now provides:

- Median registration duration and the number of timed registrations
- Paperless registration percentage
- Queue wait p50 and p90, plus service-time p50 and p90
- Completed station visits per event hour
- Offline-capable active-station percentage
- Applied, pending and problematic sync actions with a sync-success rate
- Report generation time, minutes from event end and same-day status

The OpenAPI contract and generated TypeScript types were updated with the same fields.

### 2. Automatic same-day reporting

When an authorized manager completes an event, VSMS creates an `OVERVIEW` PDF export job inside the same database transaction as the status transition. The report covers the event's configured start and end bounds, inherits the configured artifact expiry and records `REPORT_EXPORT_QUEUED` with an `EVENT_COMPLETED` trigger in the audit log. If the transaction fails, neither the completion nor the report request is committed.

The existing report worker claims jobs with a lease, generates aggregate output, verifies artifact integrity and records `generatedAt`. Operations analytics use that timestamp to evaluate the same-day target.

### 3. Participant NRIC protection

New and updated NRIC values no longer enter Prisma as plaintext. VSMS encrypts each value with AES-256-GCM using record-bound additional authenticated data and creates a separate HMAC-SHA-256 blind index for equality matching. API projections strip plaintext, ciphertext, lookup hash and key-version fields.

A staged migration retains the legacy column only for controlled deployment compatibility. The provided backfill script converts existing rows in batches and verifies that no legacy or incomplete records remain. Production requires a dedicated `PARTICIPANT_LOOKUP_HMAC_KEY`; the infrastructure template injects it into API and worker tasks. A later release should remove the legacy plaintext column after production verification.

### 4. Offline scope made testable and honest

Offline support is explicitly defined as visual acuity, refraction, colour vision and custom schema-driven screening capture. Unsupported eye-health screener writes are rejected because that information belongs to clinician review. The dashboard calculates coverage from the active station mix, so an event can demonstrate whether all configured screener stations are offline-capable.

Documentation now separates “100% of supported screening capture” from “100% of the whole application.” This prevents an inaccurate business claim and identifies the work needed for complete disconnected operation.

## Security and privacy rationale

- Sensitive identifiers are encrypted before database access and bound to their participant record, reducing the impact of raw database disclosure or ciphertext substitution.
- Equality search uses a keyed blind index instead of deterministic ciphertext or plaintext search.
- Business metrics are aggregates and do not expose participant names, NRIC values or QR secrets.
- Paper exceptions store a short operational reason, not clinical notes.
- Report generation and downloads remain restricted to completed events and authorized event managers, with audit records for queueing and download.
- Offline payloads remain encrypted and owner-bound on the device; server synchronization reuses the online authorization and validation path.

## Verification performed

The increment was checked with:

- Prisma schema validation and client generation
- Backend unit and security suites: 416 passed, 5 skipped and 0 failed
- Focused completion-report test verifying event bounds, PDF format, expiry and audit metadata
- Frontend TypeScript/Vite production build
- Frontend lint
- Participant and operations focused tests
- OpenAPI lint and generated-contract consistency check

The frontend production build transformed 1,225 modules successfully and generated the PWA service worker. The final branch verification should also be quoted from CI after the latest push. Integration tests requiring PostgreSQL should be run against the same migration sequence used for deployment.

## Recommended next-level roadmap

### Priority 1: prove outcomes in a controlled pilot

Capture the paper baseline before claiming percentage improvement. For at least one comparable legacy event and two VSMS events, record median registration duration, paper forms used, completed station visits per hour, queue p90 and time-to-report. Record event size, station count and staffing so the comparison is defensible.

### Priority 2: close whole-application offline gaps

Add offline participant registration/check-in first because it affects arrival continuity. Follow with a deliberately limited clinician review outbox. Event administration and report generation can remain online-only until operational evidence shows a need; they are lower-value during a venue outage.

### Priority 3: formalize security assurance

Create an OWASP ASVS control matrix, attach CI dependency and static-analysis evidence, run authenticated API and infrastructure penetration tests, document findings and retest remediation. Only then use a formal compliance or assurance statement.

### Priority 4: operational reliability

Alert when an automatically queued completion report misses the event-local same-day deadline, when sync conflicts exceed a threshold or when the report worker has stopped claiming jobs. These alerts turn dashboard evidence into actionable operations.

## Suggested report conclusion

VSMS replaces the core paper-driven screening journey with an event-scoped, role-controlled digital workflow. The implementation supports event setup, electronic registration and QR hand-off, live queues, station results, clinical review, referrals, aggregate reporting and near-real-time operations monitoring. The latest increment strengthens the solution by measuring its business outcomes, automatically producing a completion report and protecting NRIC values at the application boundary. The remaining material gap is whole-application offline operation. The correct next step is a measured pilot followed by offline registration/check-in and independent security assurance, rather than adding unrelated features before the stated objectives are proven.
