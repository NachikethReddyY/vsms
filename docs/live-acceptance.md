# Live acceptance kit

This kit prepares a repeatable, synthetic acceptance run. It makes no AWS, Cognito, browser, deployment, or production calls, and a newly prepared evidence file is deliberately `NOT_RUN` everywhere.

## 1. Reset the local fixture

Use only a disposable local PostgreSQL database named `vsms_demo` or `vsms_acceptance_demo`. The reset command rejects every other name and every non-loopback host before invoking Prisma.

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/vsms_demo'
export VSMS_DEMO_ANCHOR_DATE='2026-08-10'
pnpm --dir backend acceptance:reset
pnpm --dir backend acceptance:check
```

`VSMS_DEMO_ANCHOR_DATE` makes the fixture's business dates reproducible. For a browser run requiring a current duty, choose and record that run's local calendar date instead. Database-generated UUIDs and `updatedAt` values are not stable evidence; the stable fixture references and values are.

The seed creates only synthetic identities (`Synthetic …`, `TEST-NRIC-…`, `example.test`) and marks screening payloads `SYNTHETIC_ACCEPTANCE_ONLY`. It gives the synthetic administrator event-manager memberships, the synthetic registration officer a live-event registration membership/duty, and the synthetic reviewer a live-event reviewer membership/duty. It also includes consent, registration, QR, check-in-ready queue, transfer, review/referral, and sync-state data.

Do not use `acceptance:reset` against an approved live environment. It is intentionally local-only; deployment migrations use the normal deployment procedure.

## 2. Prepare and retain evidence

Create a directory outside tracked source files, then prepare an evidence contract. The runner refuses to overwrite an existing file.

```bash
mkdir -p backend/evidence
pnpm --dir backend acceptance:prepare -- evidence/live-acceptance.json
pnpm --dir backend acceptance:validate -- evidence/live-acceptance.json --allow-incomplete
```

For every passed scenario, record an ISO timestamp, a path to a sanitized screenshot, request IDs, HTTP statuses, and aggregate row counts. Once any scenario is passed, also record:

- the migration revision and its timestamp;
- the deployed service revision, `/health` status, and timestamp;
- the approved environment label.

Do not retain passwords, MFA values, cookies, authorization headers, access or refresh tokens, QR bearer values, unmasked participant details, real emails, NRICs, phone numbers, or raw exports. The validator rejects sensitive field names and common secret/PII-looking values, but it cannot inspect a screenshot: redact the pixels before saving it. Use synthetic fixture labels and aggregate counts in screenshots.

When every scenario is either passed, failed, or honestly blocked, validate without the incomplete allowance:

```bash
pnpm --dir backend acceptance:validate -- evidence/live-acceptance.json
```

`PASSED` means evidence was recorded, not that this branch performed the live action.

## 3. Acceptance run order

The executable scenario catalogue is [`backend/acceptance/live-workflow.json`](../backend/acceptance/live-workflow.json).

1. Run the automated local kit check and retain its command output.
2. In an approved live deployment only, invite a synthetic account; complete managed password and MFA setup; verify provider-group/local-role intersection and session restoration.
3. Give synthetic staff an active event membership and duty. Show one allowed duty action, then repeat it on another event and retain the denied status/request ID.
4. Suspend, revoke session, and deprovision separate synthetic accounts. Show the existing session denied after each action. Do not reuse a real staff account.
5. Register Synthetic Charlie, record consent, issue/verify a QR pass, check in, and capture aggregate registration/queue count changes.
6. Transfer through visual acuity, refraction, and colour vision queues. Capture only the synthetic fixture marker, request IDs, statuses, and counts.
7. Record a review/referral with the synthetic recipient; retain a masked view only.
8. Download an assigned station while online, disconnect, save one synthetic result, reconnect, and show one applied sync action without a duplicate.
9. Compare dashboard aggregate counts with the recorded row counts, then generate an authorized event export/report without retaining its contents.

## What is locally proven vs blocked

| Area | Status from this branch |
| --- | --- |
| Fixture shape, local-only reset guard, scenario catalogue, evidence template/validation | Automated locally by `acceptance:check` and its unit test. |
| Authorization, lifecycle, QR, queue, review/referral, sync implementation | Has existing local backend/frontend test coverage; this is not browser/live proof. |
| Invitation, password, MFA, Cognito group intersection, session revocation, suspension/deprovisioning | Requires an approved deployment and synthetic Cognito accounts; no AWS/Cognito mutation is performed here. |
| Visual acuity, refraction, colour vision, queues/transfers, review/referral, dashboard/export | Requires a browser against an approved deployment to become live evidence. |
| Eye health fourth station | Blocked. `EYE_HEALTH` remains catalog-only in the Station Library and has no capture route/page; do not mark this path passed. |
| Offline reconnect | Requires real browser storage, an active assigned station, and a deliberate connection interruption. Unit coverage does not establish a live reconnect. |
