import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./EventRegistrationPage.tsx", import.meta.url), "utf8");
const registrationSource = await readFile(new URL("./ParticipantRegistrationPage.tsx", import.meta.url), "utf8");
const statusSource = await readFile(new URL("./ParticipantStatusPage.tsx", import.meta.url), "utf8");

test("event registration always writes the complete walk-in record to encrypted device storage first", () => {
  assert.match(source, /queueOfflineWalkInRegistration\(ownerId, eventId/);
  assert.match(source, /participant: \{\s*\.\.\.participant/);
  assert.match(source, /emergencyContact: \{/);
  assert.match(source, /if \(online\) await ensureOfflineReady\(eventId\)/);
  assert.doesNotMatch(source, /\/participants\/match|apiClient\.(?:post|patch)/);
});

test("event registration shows only local queue and station numbers until canonical sync", () => {
  assert.match(source, /saved\.queueNumber/);
  assert.match(source, /saved\.stationNumber/);
  assert.match(source, /No QR code exists until the server confirms/);
  assert.doesNotMatch(source, /qrImage|passToken|qrToken/);
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
  assert.match(statusSource, /SKIPPED: 'Skipped'/);
  assert.doesNotMatch(statusSource, /\/qr\/handoff|LiveStationHandoffPicker|Station workload|currentQueueNumber|aheadAtStation|transfers/);
});
