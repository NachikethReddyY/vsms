import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./EventRegistrationPage.tsx", import.meta.url), "utf8");

test("participant registration checks a full identity combination before creating a participant", () => {
  assert.match(source, /apiClient\.post<MatchResponse>\("\/participants\/match"/);
  assert.match(source, /firstName: form\.firstName\.trim\(\), lastName: form\.lastName\.trim\(\), dateOfBirth: form\.dateOfBirth, contactNumber: form\.contactNumber\.trim\(\)/);
  assert.match(source, /if \(data\.result === "NO_MATCH"\) \{\s*await registerNewParticipant\(\);/);
});

test("participant registration keeps entered details when continuing to the participant profile", () => {
  assert.match(source, /navigate\(`\/participants\/\$\{response\.data\.participant\.id\}\?eventId=\$\{encodeURIComponent\(eventId\)\}`\)/);
  assert.match(source, /state: \{ registrationDraft: form \}/);
});

