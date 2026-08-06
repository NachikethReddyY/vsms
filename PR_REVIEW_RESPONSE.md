# PR Review Response — Feature: Participant QR Generator

Thanks for the review, Nachiketh. I've addressed all four points. Summary of the changes and how each concern was resolved:

## 1. Global `authLimiter` causes 429 on auth callback tests

**Fixed.** The duplicate global limiter was removed from `backend/app.js`.

- The auth routes already carry their own endpoint-level limits, so the extra IP-wide limiter added no protection and only broke the callback flow under CI traffic.
- `app.js` now mounts `"/api/v1/auth"` with no extra limiter on top of the per-endpoint limits in `authRoutes`.
- Verified: the full `cognito-callback-redirect` suite (7 tests) passes — previously several were failing with `429`.

## 2. Legacy `/api/...` aliases removed but integration tests still use them

**Fixed — aliases restored (backward compatible).** Rather than migrating every existing integration test to `/api/v1`, the legacy mounts were restored in `backend/app.js` after the versioned mounts:

- `/api/users`
- `/api/public/events`
- `/api/events` (with auth + `mutationLimiter` on mutative routes, plus `screeningRoutes`)
- `/api/locations`
- `/api/qr` (with `qrLimiter`)

Verified against the database integration set (`events.integration`, `reviews.integration`, `auth.integration`, `qr.integration`, `sync.integration`): all pass, and `GET /api/events` now returns `401` from the same auth guard as the v1 route.

## 3. CI stops after the first backend test stage fails

**Fixed.** Added `if: always()` to the four post-unit-test backend stages in `.github/workflows/ci.yml`:

- Run database integration and security tests
- Validate Prisma schema
- Lint OpenAPI contract
- Verify generated API client

The integration stage no longer silently becomes a no-op when the unit stage fails — you get a complete picture of what broke.

## 4. PR contains many "unrelated" changes

This is a fair point and I want to be transparent about it. The changes fall into two groups:

### a) Changes that landed via merges from `main`

The branch is long-lived and was merged from `main` several times (e.g. the merge commits `06239f2`, `3cdcf01`, `e499955`). Some files that look "unrelated" — audit logging, DB migrations, server config, logging, seed — are actually `main` commits that arrived through those merges, not work authored in this PR.

### b) Hardening that is a prerequisite for shipping this feature

The participant QR generator exposes participant PII through new endpoints, so the following were added as required hardening in the same security review:

| Change | Why it's needed |
| --- | --- |
| Redis-backed rate limiting (`backend/middlewares/rateLimiter.js`, `docker-compose.yml`, `RATE_LIMIT_STORE`) | Protects the new participant-facing QR endpoints and the existing auth/registration routes from brute-force and abuse |
| `Permission`/`RolePermission` RBAC enforcement (`requirePermission.js`, wired into participant/consent/registration/admin routes) | The QR feature grants end-users access to participant records; every mutation and read now goes through explicit permission checks (`participants:read`, `consents:record`, `registrations:read`, `audit:read`) |
| Immutable audit logging + migrations | Needed so the new `audit:read`-gated admin routes operate on trustworthy, tamper-evident logs |
| CI fixes (this PR) | The test/contract checks would not actually run without them |

A local account-lockout helper was initially added but removed after review: Cognito is the real password gate, so there is no genuine failed-password signal to key a local lockout on, and counting OAuth/refresh errors as login failures would be incorrect.

These are interdependent:

- The auth-callback tests only run reliably once the duplicate auth limiter is removed (point 1).
- The RBAC tests require the new permission model and its migration.
- The integration tests require the legacy route aliases (point 2).

### Split option

If you still prefer focused PRs, I can split this into:

1. **Rate limiting + Redis** — limiter middleware, `docker-compose.yml`, env config
2. **RBAC** — permission model, `requirePermission`, tests
3. **Immutable audit logging** — triggers, migrations
4. **CI fixes** — `if: always()`, legacy route aliases

Say the word and I'll rebase accordingly. Otherwise, here is the full verification I ran before this review:

## Verification

- Backend unit + security: **246/246 pass**
- Backend database integration set: **41/41 pass** (against a freshly migrated test database, mirroring CI's `prisma migrate reset`)
- `pnpm prisma:validate`: pass
- `pnpm openapi:lint`: pass (7 pre-existing warnings, no errors)
- `pnpm contracts:check`: pass (generated frontend types match the OpenAPI contract)
- Frontend lint, `test:participants`, `test:queue`, build: **all pass**
