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

test("registration uses the assigned route and never asks staff to create a queue handoff", () => {
  assert.match(registrationSource, /response\.data\.route/);
  assert.match(registrationSource, /Route assigned/);
  assert.match(registrationSource, /The participant keeps this QR throughout the event/);
  assert.doesNotMatch(registrationSource, /\/handoff|LiveStationHandoffPicker|Select a station/);
});

test("participant status polling is non-overlapping and retains delayed state", () => {
  assert.match(statusSource, /if \(inFlight\) return Promise\.resolve\(\)/);
  assert.match(statusSource, /setInterval\(\(\) => void fetchStatus\(\), POLL_MS\)/);
  assert.match(statusSource, /if \(error && !status\)/);
  assert.match(statusSource, /Update delayed/);
  assert.match(statusSource, />Retry</);
});

test("participant status renders only the server route and never creates handoff QR codes", () => {
  assert.match(statusSource, /status\.route\.map/);
  assert.match(statusSource, /Your event route/);
  assert.doesNotMatch(statusSource, /\/qr\/handoff|LiveStationHandoffPicker|Station workload|currentQueueNumber|aheadAtStation|transfers/);
});
