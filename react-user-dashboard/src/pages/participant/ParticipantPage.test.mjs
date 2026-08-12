import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./EventRegistrationPage.tsx", import.meta.url), "utf8");
const registrationSource = await readFile(new URL("./ParticipantRegistrationPage.tsx", import.meta.url), "utf8");
const statusSource = await readFile(new URL("./ParticipantStatusPage.tsx", import.meta.url), "utf8");

test("participant registration checks a full identity combination before creating a participant", () => {
  assert.match(source, /apiClient\.post<MatchResponse>\("\/participants\/match"/);
  assert.match(source, /firstName: form\.firstName\.trim\(\), lastName: form\.lastName\.trim\(\), dateOfBirth: form\.dateOfBirth, contactNumber: form\.contactNumber\.trim\(\), nric: form\.nric/);
  assert.match(source, /if \(data\.result === "NO_MATCH"\) \{\s*await registerNewParticipant\(\);/);
});

test("participant registration keeps entered non-sensitive details when continuing to the participant profile", () => {
  assert.match(source, /navigate\(`\/participants\/\$\{response\.data\.participant\.id\}\?eventId=\$\{encodeURIComponent\(eventId\)\}`\)/);
  assert.match(source, /Object\.entries\(form\)\.filter\(\(\[field\]\) => field !== "nric"\)/);
  assert.match(source, /state: \{ registrationDraft \}/);
  assert.match(source, /match\.matchReasons\.includes\("NRIC \/ FIN"\)/);
});

test("pre-event registration opens the QR pass without starting an unavailable station handoff", () => {
  assert.match(registrationSource, /existingRegistration\.queueNumber != null \|\| reviewResponse\.data\.event\.status !== "IN_PROGRESS"/);
  assert.match(registrationSource, /if \(review\?\.event\.status !== "IN_PROGRESS"\) \{\s*navigate\(`\/participants\/registrations\/\$\{registrationId\}\/qr/);
});

test("participant status polling is non-overlapping and retains delayed state", () => {
  assert.match(statusSource, /if \(inFlight\) return Promise\.resolve\(\)/);
  assert.match(statusSource, /setInterval\(\(\) => void fetchStatus\(\), POLL_MS\)/);
  assert.match(statusSource, /if \(error && !status\)/);
  assert.match(statusSource, /Update delayed/);
  assert.match(statusSource, />Retry</);
});
