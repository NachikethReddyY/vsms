# Merge evidence — station library, eye-health station, PWA shell

Branch: `feature/eye-health-review-observations`  
Scope: backlog slices **#23** (station library), **#26** (eye-health station), **#28** (installable offline shell).

## Issue status (keep open)

Keep GitHub issues **#23 / #26 / #28 open**. CI-green automated coverage is necessary but **not** a full definition of done.

| Issue | Automated evidence in this PR | Still required before closing |
|---|---|---|
| #23 Station Library | Admin API CRUD + `StationLibraryPage` tests (load/empty/error/create validation) | Live admin walkthrough: create → import into event → deactivate → confirm import picker excludes inactive |
| #26 Eye-health station | Online save/flag unit tests, review integration fixtures, offline outbox + sync conflict tests, page validation/error tests | Live online save on duty-assigned station; live offline queue → reconnect sync; clinical sign-off on flag thresholds |
| #28 Offline PWA | `vite-plugin-pwa` build produces SW/manifest; existing IndexedDB sync suite + EYE_HEALTH path | Install prompt / installed shell hard-refresh offline; verify station routes load from precache without network |

## Migration compatibility

See [`backend/docs/migrations/20260810120000_add_review_eye_health_observations.md`](../backend/docs/migrations/20260810120000_add_review_eye_health_observations.md).

- Forward: nullable JSONB add; existing reviews compatible.
- Rollback: documented `DROP COLUMN` with data-loss note for reviewer addenda only.

## Generated contract consistency

Run before merge:

```bash
pnpm --dir backend openapi:lint
pnpm --dir backend contracts:check
pnpm check:api-collection
```

These gate OpenAPI ↔ `react-user-dashboard/src/generated/api.ts` ↔ `api-testing/event-api.collection.*`.

## Automated tests added / extended for this review

- Frontend: `StationLibraryPage.test.tsx`, `EyeHealthStationPage.test.tsx`, `offlineSync.test.ts` (EYE_HEALTH apply/conflict/idempotent reconnect), Stage4 `StationDutyGuard` coverage for EYE_HEALTH
- Backend: `sync-service.test.js` EYE_HEALTH apply/idempotent replay/conflict; mapping/authorization contracts expect importable eye health
- Existing: screening flag/schema unit tests; review decision optional observations; review integration fixtures include EYE_HEALTH stations

Run locally:

```bash
pnpm --dir react-user-dashboard test:offline
pnpm --dir react-user-dashboard test:stage4
pnpm --dir backend exec node --test tests/unit/sync-service.test.js
```

## Rebase / integration against #100 and #105 (required before merge)

Do **not** merge until this branch is rebased (or merged) onto the latest main containing:

1. **[P0][Quality] Isolate the integration-test database and restore the full test gate** (#100)  
   - Re-run `pnpm --dir backend test` and `pnpm --dir backend test:integration` against the isolated DB harness.
2. **[P1][Architecture] Align request layers and map required APIs to the real contract** (#105)  
   - Re-verify OpenAPI paths/DTO names for station-templates and eye-health endpoints still match the request-layer map after #105 lands.

Document the rebase SHA and green CI run in the PR conversation when complete.

## Suggested PR reply (short)

> Addressed review asks with migration forward/rollback notes, targeted page + offline sync conflict/idempotency tests, and contract check commands. Leaving #23/#26/#28 open pending live/offline evidence. Will rebase onto #100/#105 and re-run the full isolated integration gate before merge.
