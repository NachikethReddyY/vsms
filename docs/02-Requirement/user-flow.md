# VSMS user flow

## Roles

- **Administrator:** creates users, events, stations, and staff assignments.
- **Registration officer:** registers and updates participants, then sends them to a station queue.
- **Screener:** completes the assigned screening steps, acknowledges any automatic flags, and moves the participant on.
- **Reviewer:** reviews completed results and creates a referral when required.
- **Event manager:** watches the event dashboard and queue/sync state.

## Golden demonstration flow

```text
Sign in
  -> select active event
  -> register participant (or find and update one)
  -> issue participant ID and add to first station queue
  -> screener opens the queued participant
  -> record visual-acuity, refraction, colour-vision, and eye-health results
  -> system flags out-of-threshold results; screener acknowledges the flag
  -> transfer participant through remaining stations
  -> reviewer checks the completed record and flags
  -> reviewer records outcome: complete or referral
  -> event dashboard shows updated queue, completion, referral, and sync totals
```

## Offline branch

```text
Network unavailable
  -> the same participant and screening forms remain usable
  -> writes are saved locally as pending actions
  -> network returns
  -> user syncs (or the app retries)
  -> server accepts each action once using its idempotency key
  -> dashboard reflects the synced records
```

## Access rules

- Every request requires a signed-in user; the backend enforces role permissions.
- Users only see actions needed for their role.
- Registration, result changes, review, referral, and sync outcomes create audit records.
