const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveEventStatus } = require("../../services/event/eventLifecycle");

const now = new Date("2026-08-14T00:00:00.000Z");

test("expired unstarted events are cancelled", () => {
  assert.equal(effectiveEventStatus("DRAFT", "2026-08-13T09:00:00.000Z", now), "CANCELLED");
  assert.equal(effectiveEventStatus("PUBLISHED", "2026-08-13T09:00:00.000Z", now), "CANCELLED");
});

test("expired started events are completed while future events stay open", () => {
  assert.equal(effectiveEventStatus("IN_PROGRESS", "2026-08-13T09:00:00.000Z", now), "COMPLETED");
  assert.equal(effectiveEventStatus("PUBLISHED", "2026-08-14T09:00:00.000Z", now), "PUBLISHED");
});
