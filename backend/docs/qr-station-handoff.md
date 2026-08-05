# QR ↔ screening station handoff

**Status:** contract for staff scan → station load. Do **not** put `stationId` in the QR payload.

## QR payload (token-only)

Generated QR images encode a **token only** (via a frontend URL), for example:

```text
http://<host>:<port>/participant-status/<token>
```

or a raw hex token string. The token is `QRCodePass.token` (64-char hex in production; demo seed also uses `VSMS-DEMO-QR-001`).

The QR must **not** embed `stationId`, station slug, or screening type. Station choice is a staff UI decision after verify.

## After verify — handoff identity

`POST /api/v1/qr/verify` with `{ "token": "<qr token>" }` returns (among other fields):

| Field | Use |
| --- | --- |
| `registrationId` | Participant registration to screen |
| `event.id` | Event id (`eventId`) for station routes |

Handoff = **`eventId` + `registrationId`**. Staff then open a station page.

## Target station URL

```text
/events/{eventId}/stations/{slug}?registrationId={registrationId}
```

| Station type | `slug` |
| --- | --- |
| Visual acuity (default after scan) | `visual-acuity` |
| Refraction | `refraction` |
| Colour vision | `colour-vision` |

Station pages already read `?registrationId=` and pre-select that participant. Staff may also paste the QR token / pass value into **Load pass**; resolve accepts `EventRegistration.passToken` **or** `QRCodePass.token` (see `GET /events/:eventId/registrations/resolve`).

## Staff UI entry points

| Route | Role |
| --- | --- |
| Station pages (`…/stations/{slug}`) | **Scan QR with camera** or Load pass → screen → after save, tablet shows participant QR for next queue |
| `/qr-scanner` | Camera or paste → verify → pick station (default VA) |
| `/participant-status/:token` | URL encoded in the QR; verify/load → continue to station |

After a successful station save, the tablet loads `GET /api/v1/events/{eventId}/registrations/{registrationId}/pass-display` and shows the QR image so the participant can re-enter the next station queue.

## Confirm demo stations exist

Seed creates VA / Refraction / Colour Vision `Station` rows on each demo event (not Eye Health). Confirm with:

```bash
# after seed — console prints Demo QR token + Registration ID
npx prisma db seed

# or authenticated API
GET /api/v1/events/{eventId}/stations
```

Expect three active stations with types `VISUAL_ACUITY`, `REFRACTION`, `COLOUR_VISION`.
