# Station template → event Station → screening (Issue #30)

**Status:** implemented for Issue **#24** (import/update against `Station`).
**Scope:** mapping and import semantics — see root [`erd.md`](../../erd.md) for the broader Issue #7 / platform ERD.

---

## 1. What exists in Prisma today

| Model | Role |
|---|---|
| `StationTemplate` | Catalog of reusable templates (`templateKey`, `name`, `defaultCapacity`, `active`, …). **No FK** to events or stations. |
| `Station` | **Canonical per-event runtime table.** Used by queue, scan, staff assignment, and screening. |
| `ScreeningResult` | Points at `Station` (`stationId`) and stores `screeningType: StationType`. |
| `EventStationAvailability` | Per–event-day capacity / windows. Column is still named `event_station_id`; **no Prisma relation** to `Station` (and there is **no** `EventStation` model). |
| `EventStation` | **Gone** from `schema.prisma`. OpenAPI + some eventService helpers still speak “EventStation” as a **DTO** over `Station`. |

### `StationType` enum (screening / runtime)

```text
VISUAL_ACUITY | REFRACTION | COLOUR_VISION | EYE_HEALTH | CUSTOM
```

### Dynamic field schemas

| Model | Field | Notes |
|---|---|---|
| `StationTemplate` | `fieldSchema` | JSON array of field definitions — **editable and frozen only for CUSTOM**. Built-in VA/REF/CV keep hard-coded clinical forms/rules. |
| `Station` | `fieldSchemaSnapshot` | Frozen CUSTOM schema at import/create. Null for built-in clinical stations. |
| `Station` | `schemaVersion` | Template version captured with the snapshot. |
| `ScreeningResult` | `schemaVersion` | Version recorded with the saved result. |

### `Station` fields that import can set

| Field | Notes |
|---|---|
| `stationType` | Required. Clinical types (VA/REF/CV) are one-per-event (enforced in service). `CUSTOM` may appear multiple times (unique by `stationTemplateId`). Eye health is review-only and not importable. |
| `stationTemplateId` | Links runtime station to catalog template (required for idempotent CUSTOM re-import). |
| `stationName` | Display name (from template `name` unless overridden later). |
| `stationOrder` | Unique per `(eventId, stationOrder)`. |
| `isActive` | Soft availability for screening/queue (`true` = usable). |
| `fieldSchemaSnapshot` / `schemaVersion` | Copied from template on import; not mutated when the catalog template later changes. |
| *(no `capacity`)* | Capacity is **not** on `Station`. It lives on `StationTemplate.defaultCapacity` and on `EventStationAvailability.capacity`. |

---

## 2. Seeded templates (`backend/prisma/seed.js`)

| `templateKey` | Name | `defaultCapacity` |
|---|---|---:|
| `REGISTRATION` | Registration | 3 |
| `VISUAL_ACUITY` | Visual acuity | 4 |
| `EYE_HEALTH` | Eye health | 2 |
| `CLINICAL_REVIEW` | Clinical review | 2 |
| `REFRACTION` | Refraction | 3 |
| `COLOUR_VISION` | Colour vision | 3 |
| `CUSTOM_OD_NOTES` | Custom OD notes (demo CUSTOM) | 2 |

Demo event seeding creates **runtime** `Station` rows for VA / Refraction / Colour Vision only. Eye Health stays in clinical review; Registration and Clinical Review are workflow roles, not screening stations.

Every station resolves the same active secure participant QR; no generated station-handoff QR is used.

---

## 3. API stub status (as of main after #23)

| Endpoint / helper | Status |
|---|---|
| `listStationTemplates` | **Real** — reads active `StationTemplate` rows (#23). |
| `importStations` / `updateStation` | **Implemented (#24)** — upserts `Station` by `(eventId, stationType)`; path `eventStationId` = `stationId`. |
| Event response `eventStations` | Mapped from `Station` with placeholder DTO fields (`stationTemplateId` currently reused as station id; `availabilities: []`; `capacity` taken from event capacity). |
| Legacy helpers (`createEventStations`, update paths calling `tx.eventStation.*`) | Still reference a removed Prisma model — **dead / broken** for #24; replace with `Station` (+ optional availability). |

---

## 4. Proposed agreement (recommend for #24)

### A. Canonical runtime table = `Station`

- Screening, queue, scans, and staff–station links already use `Station`.
- Do **not** reintroduce an `EventStation` table. Keep OpenAPI `EventStation` as the **response DTO** whose id is `Station.stationId` (path param `eventStationId` = `stationId`).

### B. `templateKey` → `StationType` mapping (code table)

Keep this as a **backend constant** (or seed-maintained map) used by import — not a free-form client string:

| `templateKey` | Maps to `StationType`? | Import as `Station`? |
|---|---|---|
| `VISUAL_ACUITY` | `VISUAL_ACUITY` | **Yes** |
| `REFRACTION` | `REFRACTION` | **Yes** |
| `COLOUR_VISION` | `COLOUR_VISION` | **Yes** |
| `EYE_HEALTH` | — | **No** — clinician review observations only (not a screener station) |
| `CUSTOM_*` (e.g. `CUSTOM_OD_NOTES`) | `CUSTOM` | **Yes** — multiple CUSTOM stations allowed per event; matched by `stationTemplateId` |
| `REGISTRATION` | — | **No** |
| `CLINICAL_REVIEW` | — | **No** |

**Why exclude Registration and Clinical Review**

- Registration and Clinical Review are **not** values of `StationType`, and `Station.stationType` is required.
- Registration is a **workflow / role** (`StaffAssignmentRole.REGISTRATION`, check-in / QR), not a screening station. Seed assigns registration officers with `stationId: null`.
- Clinical review is the **`Review`** domain (outcomes, referrals), not `ScreeningResult` / queue-at-station.

Import should **422** (or skip with a clear error) if the client includes those template IDs in `stationTemplateIds`.

### C. What import should write on each importable template

For each selected active template that maps to a `StationType`:

| Target | Source / rule |
|---|---|
| `eventId` | Path event |
| `stationType` | From mapping table above |
| `stationTemplateId` | Source template id |
| `stationName` | `StationTemplate.name` |
| `stationOrder` | Assign deterministically (e.g. catalog order or request order); must satisfy `@@unique([eventId, stationOrder])` |
| `isActive` | Default `true` |
| `fieldSchemaSnapshot` | Copy of `StationTemplate.fieldSchema` (parsed/validated) |
| `schemaVersion` | `StationTemplate.version` |
| Capacity | **Do not** invent a `Station.capacity` column unless the team agrees to a schema change. Prefer: store day-level capacity on `EventStationAvailability`, or leave capacity in the OpenAPI DTO as derived until availability is wired. |

Idempotency: clinical types upsert by `(eventId, stationType)`; CUSTOM upserts by `(eventId, stationTemplateId)`. Re-import updates name/order/active/schema snapshot rather than inserting a duplicate.

### D. Availability — relate or defer

`EventStationAvailability` already has `eventStationId` + `eventDayId` + `capacity` + optional time window.

**Recommendation for #24 MVP**

1. Treat `event_station_id` as **`Station.stationId`** (rename in a later migration if desired).
2. Add a Prisma relation `Station` ↔ `EventStationAvailability` when wiring import/update.
3. **MVP import:** create `Station` rows only; leave `availabilities: []` (matches current event DTO). Day-level capacity can land in `updateEventStation` or a follow-up once event days are reliable.
4. Do **not** block screening on availability rows — screening already gates on `Station.isActive` + `stationType`.

---

## 5. Open questions for teammates

**Events / #24 owner**

1. Confirm OpenAPI keeps `EventStation` naming with `eventStationId === stationId`, or we rename paths/DTOs to `stationId` in the same PR.
2. On import conflict (station type already exists): update in place, or 409?
3. Should import auto-create one `EventStationAvailability` per `EventDay` using `defaultCapacity`, or defer entirely?

**Screening owners**

4. ~~Is `EYE_HEALTH` in scope for import now?~~ **Decided:** review-only; clinicians may add optional eye-health notes on review decisions.
5. Should `stationName` stay editable after import without changing `stationType`?

**Auth / staffing owners**

6. Registration / Reviewer staffing stays **station-less** (`stationId` null + role), correct?
7. Screener assignments must reference an imported `Station` — should import be required before screener assignment is allowed?

**Queue owners**

8. Any assumption that queue entries exist for Registration/Clinical Review “stations”? (Schema says queue → `Station` only; if yes, that conflicts with excluding those templates.)

---

## 6. Thumbs-up checklist

- [ ] Canonical runtime table is `Station` (no new `EventStation` table).
- [ ] VA / REFRACTION / COLOUR_VISION import as clinical stations (one per type per event).
- [ ] CUSTOM templates import as dynamic stations (multi allowed; schema snapshot frozen).
- [ ] EYE_HEALTH stays catalog/review-only (not a screener station).
- [ ] REGISTRATION + CLINICAL_REVIEW stay catalog-only (not screening stations).
- [ ] Import sets `stationType`, `stationTemplateId`, `stationName`, `stationOrder`, `isActive`, `fieldSchemaSnapshot`, `schemaVersion`; capacity via availability or deferred.
- [ ] Availability: `event_station_id` means `station_id`; day rows optional for #24 MVP.
- [ ] Open questions above answered or explicitly deferred.
)
