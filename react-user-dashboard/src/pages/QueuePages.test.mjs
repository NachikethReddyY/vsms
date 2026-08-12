import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const pageSource = await readFile(new URL("./QueuePages.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../features/queue/queueApi.ts", import.meta.url), "utf8");

test("queue dashboard is wired to the virtual queue API", () => {
  assert.match(pageSource, /queueApi\.getEventQueueStatus/);
  assert.match(pageSource, /queueApi\.updatePriority/);
  assert.match(pageSource, /queueApi\.callQueueEntry/);
  assert.match(pageSource, /queueApi\.completeQueueEntry/);
  assert.match(pageSource, /queueApi\.skipQueueEntry/);
  assert.doesNotMatch(pageSource, /generateMockQueue|new Server\(/);
  assert.doesNotMatch(pageSource, /\/registrations\/\$\{registrationId\}\/status/);
});

test("queue API calls the event-scoped virtual queue endpoints", () => {
  assert.match(apiSource, /`\/queues\/events\/\$\{eventId\}`/);
  assert.match(apiSource, /`\/events\/\$\{eventId\}\/entries\/\$\{queueId\}\/priority`/);
  assert.match(apiSource, /`\/events\/\$\{eventId\}\/entries\/\$\{queueId\}\/call`/);
  assert.match(apiSource, /`\/events\/\$\{eventId\}\/entries\/\$\{queueId\}\/complete`/);
  assert.match(apiSource, /`\/events\/\$\{eventId\}\/entries\/\$\{queueId\}\/skip`/);
});

test("queue polling prevents older requests from replacing newer state", () => {
  assert.match(pageSource, /const requestSequence = useRef\(0\)/);
  assert.match(pageSource, /sequence !== requestSequence\.current/);
  assert.match(pageSource, /setInterval\(\(\) => void fetchQueue\(\), 10_000\)/);
});
