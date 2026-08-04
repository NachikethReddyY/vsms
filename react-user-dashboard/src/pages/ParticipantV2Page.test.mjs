import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ParticipantV2Page.tsx", import.meta.url), "utf8");

test("participant registration restores an eligible event from the URL", () => {
  assert.match(source, /searchParams\.get\("eventId"\)/);
  assert.match(source, /REGISTRATION_EVENT_STATUSES = new Set\(\["PUBLISHED", "IN_PROGRESS"\]\)/);
  assert.match(source, /registrationEvents\.some\(\(event\) => event\.eventId === requestedEventId\) \? requestedEventId/);
});
