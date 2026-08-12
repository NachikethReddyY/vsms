# Automatic routing verification

Date: 2026-08-12
Branch: `feat/automatic-routing-single-qr`

## Automated checks

- `pnpm --dir backend prisma:validate` — passed.
- `pnpm --dir backend prisma:generate` — passed.
- `pnpm --dir backend test` — 405 passed, 0 failed.
- `pnpm --dir backend test:integration` against isolated PostgreSQL — 77 passed, 0 failed.
- Automatic-routing PostgreSQL coverage — passed for simultaneous first saves, immutable replay, corrections, one-active-queue uniqueness, route-version conflicts, unavailable-station deferral, and urgent terminal queue cancellation.
- Secure QR coverage — passed for active, expired, revoked, malformed, legacy, demo, and cross-event credentials, plus minimal public responses.
- `pnpm --dir backend openapi:lint` — passed.
- `pnpm --dir backend contracts:check` — passed.
- `pnpm check:api-collection` — passed after regenerating both API collections.
- `pnpm --dir backend perf:check` — passed configuration and safety checks for 500 participant pollers at 5 seconds plus staff polling at 10 seconds.
- `pnpm --dir react-user-dashboard lint` — passed.
- `pnpm --dir react-user-dashboard test` — passed, including polling, offline progression, route editing, and scanner controls.
- `pnpm --dir react-user-dashboard build` — passed. Vite reported the repository's existing large-chunk warning.
- `pnpm check:https` — passed against the local HTTPS API and frontend.
- `pnpm --dir backend exec playwright test tests/e2e/participant-status.spec.ts --list` — the updated single-QR browser contract compiles and is discovered.
- `git diff --check` — passed.

## Clean-container CI

- Node 24 frontend container: frozen install, lint, full tests, and production build passed.
- Node 24 backend container with PostgreSQL client and a dedicated least-privilege PostgreSQL database: frozen install, migrations, 405 unit/security tests, 77 integration tests, Prisma validation, and OpenAPI lint passed.
- The container contract gate identified stale generated API collections. They were regenerated and the API-collection parity and generated-client checks then passed in the preserved clean container.

## Browser evidence

- Desktop after-state recording: `/Users/nr/.t3/userdata/browser-artifacts/browser-recording-msq3dy4w.mp4`.
- The built landing shell rendered at 1280×800 with no browser console or network errors.
- The shared browser's tablet resize operation timed out, and the authenticated station/review routes had no reusable Cognito session. No authorization bypass was introduced to capture them.
- Playwright Chromium installation downloaded but did not finalize before the bounded wait, so the focused E2E was compile-listed but not executed locally.
- A pre-change browser capture was not available because browser validation began after the implementation slices were committed.

## Graphify

- Final incremental code-only rebuild passed: 4,507 nodes, 7,509 edges, 356 communities.
- Six changed documentation files were skipped because no supported semantic-extraction key was configured; code extraction was complete.

## Remaining external validation

- Run the acknowledged live performance fixture to measure the configured 500 participant clients and representative staff polling against a deployed-like API. The runner gates read p95 at 250 ms, write p95 at 500 ms, and errors at 1%.
- Validate real front/rear cameras, a physical QR reader, and tablet touch behavior on event hardware.
- Capture authenticated station, general-scanner, route-editor, and clinical-review screenshots after a human supplies a Cognito session.
