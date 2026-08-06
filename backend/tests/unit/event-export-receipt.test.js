const assert = require("node:assert/strict");
const test = require("node:test");
const { createExportReceipt, verifyExportReceipt } = require("../utils/eventExportReceipt");

const secret = "a".repeat(32);
const claim = {
  eventId: "11111111-1111-4111-8111-111111111111",
  version: 3,
  actorUserId: "22222222-2222-4222-8222-222222222222",
  exportHash: "b".repeat(64),
  secret,
};

test("export receipts accept a matching, unexpired export", () => {
  const now = Date.UTC(2026, 0, 1);
  const receipt = createExportReceipt({ ...claim, now });
  assert.deepEqual(verifyExportReceipt(receipt, { ...claim, now }), {
    eventId: claim.eventId,
    version: claim.version,
    actorUserId: claim.actorUserId,
    exportHash: claim.exportHash,
    expiresAt: new Date(now + (15 * 60 * 1000)).toISOString(),
  });
});

test("export receipts reject tampering, expiry, and mismatched bindings", () => {
  const now = Date.UTC(2026, 0, 1);
  const receipt = createExportReceipt({ ...claim, now });
  assert.equal(verifyExportReceipt(`${receipt}x`, { ...claim, now }), null);
  assert.equal(verifyExportReceipt(receipt, { ...claim, now: now + (15 * 60 * 1000) }), null);
  assert.equal(verifyExportReceipt(receipt, { ...claim, version: 4, now }), null);
  assert.equal(verifyExportReceipt(receipt, { ...claim, actorUserId: "33333333-3333-4333-8333-333333333333", now }), null);
});
