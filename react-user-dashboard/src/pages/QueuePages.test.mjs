import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./QueuePages.tsx", import.meta.url), "utf8");

test("queue dashboard stays wired to persisted registrations", () => {
  assert.match(source, /get<RegistrationPage>\(`\/events\/\$\{eventId\}\/registrations`/);
  assert.match(source, /patch\(`\/registrations\/\$\{registrationId\}\/status`/);
  assert.doesNotMatch(source, /generateMockQueue|new Server\(/);
});
