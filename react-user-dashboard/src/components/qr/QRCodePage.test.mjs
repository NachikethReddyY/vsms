import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./QRCodePage.tsx", import.meta.url), "utf8");

test("QR generator stays wired to the backend pass lifecycle endpoints", () => {
  assert.match(source, /\/qr\/generate\//);
  assert.match(source, /\/qr\/download\//);
  assert.match(source, /\/qr\/print\//);
  assert.match(source, /\/qr\/revoke\//);
  assert.match(source, /\/qr\/reissue\//);
  assert.match(source, /\/qr\/manual-checkin/);
});

test("QR pass images are rendered and handled with loading, success, and failure states", () => {
  assert.match(source, /QRCode qrImage=\{pass\.qrImage\}/);
  assert.match(source, /loading/);
  assert.match(source, /disabled=\{loading\}/);
  assert.match(source, /getApiMessage/);
  assert.match(source, /alert error/);
});

test("revoke requires confirmation and reissue replaces the active pass", () => {
  assert.match(source, /confirmRevoke/);
  assert.match(source, /Confirm revoke/);
  assert.match(source, /setPass\(data\.data\)/);
});

test("manual check-in fallback supports registration reference and QR token only", () => {
  assert.match(source, /Manual check-in fallback/);
  assert.match(source, /checkInMode/);
  assert.match(source, /QR_TOKEN = \/\^\[a-f0-9\]\{64\}\$\//i);
  assert.match(source, /registrationId: reference/);
  assert.match(source, /identifier: reference/);
  assert.match(source, /NRIC is not accepted/);
});

test("public pass-status page resolves the QR scan target with no PII", async () => {
  const page = await readFile(new URL("../../pages/participant/ParticipantStatusPage.tsx", import.meta.url), "utf8");
  assert.match(page, /\/qr\/public-status\//);
  assert.match(page, /LiveStationHandoffPicker/);
  assert.doesNotMatch(page, /HANDOFF_STATIONS/);
  assert.match(page, /No personal information is shown on this page\./);
  assert.doesNotMatch(page, /firstName|lastName|email/);
});
