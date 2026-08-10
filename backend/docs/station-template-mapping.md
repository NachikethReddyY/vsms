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
VISUAL_ACUITY | REFRACTION | COLOUR_VISION | EYE_HEALTH
```

### `Station` fields that import can set

| Field | Notes |
|---|---|
| `stationType` | Required; unique per `(eventId, stationType)`. |
| `stationName` | Display name (from template `name` unless overridden later). |
| `stationOrder` | Unique per `(eventId, stationOrder)`. |
| `isActive` | Soft availability for screening/queue (`true` = usable). |
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

Demo event seeding creates **runtime** `Station` rows for VA / Refraction / Colour Vision / Eye Health (not Registration or Clinical Review). Screening’s `ensureDemoStations` matches that VA/REF/CV/EH set.

QR scan → station handoff (token-only QR; `eventId` + `registrationId` after verify) is documented in [`qr-station-handoff.md`](./qr-station-handoff.md).

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
| `EYE_HEALTH` | `EYE_HEALTH` | **Yes** (screener station with offline sync; review observations optional addendum) |
| `REGISTRATION` | — | **No** |
| `CLINICAL_REVIEW` | — | **No** |

**Why exclude Registration and Clinical Review**

- Registration and Clinical Review are **not** values of `StationType`, and `Station.stationType` is required.
- Registration is a **workflow / role** (`StaffAssignmentRole.REGISTRATION`, check-in / consent / QR), not a screening station. Seed assigns registration officers with `stationId: null`.
- Clinical review is the **`Review`** domain (outcomes, referrals), not `ScreeningResult` / queue-at-station.
- **Eye Health (Option B):** catalog template + `StationType` enum remain for reference, but the template is **non-importable**. Reviewers capture `Review.eyeHealthObservations` on the clinical decision API/UI. There is no screener station page, save route, or offline sync action for eye health.

Import should **422** (or skip with a clear error) if the client includes those template IDs in `stationTemplateIds`.

### C. What import should write on each importable template

For each selected active template that maps to a `StationType`:

| Target | Source / rule |
|---|---|
| `eventId` | Path event |
| `stationType` | From mapping table above |
| `stationName` | `StationTemplate.name` |
| `stationOrder` | Assign deterministically (e.g. catalog order or request order); must satisfy `@@unique([eventId, stationOrder])` |
| `isActive` | Default `true` |
| Capacity | **Do not** invent a `Station.capacity` column in #24 unless the team agrees to a schema change. Prefer: store day-level capacity on `EventStationAvailability`, or leave capacity in the OpenAPI DTO as derived until availability is wired. |

Idempotency: honor `@@unique([eventId, stationType])` — re-import of the same type updates name/order/active rather than inserting a duplicate.

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

4. ~~Is `EYE_HEALTH` in scope for import now?~~ **Decided:** importable screener station; clinicians may still add optional eye-health notes on review decisions.
5. Should `stationName` stay editable after import without changing `stationType`?

**Auth / staffing owners**

6. Registration / Reviewer staffing stays **station-less** (`stationId` null + role), correct?
7. Screener assignments must reference an imported `Station` — should import be required before screener assignment is allowed?

**Queue owners**

8. Any assumption that queue entries exist for Registration/Clinical Review “stations”? (Schema says queue → `Station` only; if yes, that conflicts with excluding those templates.)

---

## 6. Thumbs-up checklist

- [ ] Canonical runtime table is `Station` (no new `EventStation` table).
- [ ] Only VA / REFRACTION / COLOUR_VISION / EYE_HEALTH import as `Station` (review eye-health observations remain optional addendum).
- [ ] REGISTRATION + CLINICAL_REVIEW stay catalog-only (not screening stations).
- [ ] Import sets `stationType`, `stationName`, `stationOrder`, `isActive`; capacity via availability or deferred.
- [ ] Availability: `event_station_id` means `station_id`; day rows optional for #24 MVP.
- [ ] Open questions above answered or explicitly deferred.
)
