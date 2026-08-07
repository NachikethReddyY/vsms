const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { __deletionTest } = require("../../services/eventService");

const eventId = crypto.randomUUID();
const adminId = crypto.randomUUID();
const digest = __deletionTest.impactDigest({ version: 3, counts: { registrations: 1 }, blockers: [] });

const tokenFor = (overrides = {}) => __deletionTest.signDeletionPreview({
  eventId,
  adminId,
  version: 3,
  impactDigest: digest,
  expiresAt: Date.now() + 60_000,
  ...overrides,
});

test("deletion preview token is bound to event, administrator, version, and impact", () => {
  const claims = __deletionTest.verifyDeletionPreview(tokenFor(), eventId, adminId, 3);
  assert.equal(claims.impactDigest, digest);
  assert.throws(
    () => __deletionTest.verifyDeletionPreview(tokenFor(), crypto.randomUUID(), adminId, 3),
    (error) => error.code === "DELETION_PREVIEW_MISMATCH",
  );
  assert.throws(
    () => __deletionTest.verifyDeletionPreview(tokenFor(), eventId, adminId, 4),
    (error) => error.code === "DELETION_PREVIEW_MISMATCH",
  );
});

test("deletion preview rejects tampering and expiry", () => {
  const token = tokenFor();
  const [payload, signature] = token.split(".");
  const tamperedSignature = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  assert.throws(
    () => __deletionTest.verifyDeletionPreview(`${payload}.${tamperedSignature}`, eventId, adminId, 3),
    (error) => error.code === "INVALID_DELETION_PREVIEW_TOKEN",
  );
  assert.throws(
    () => __deletionTest.verifyDeletionPreview(tokenFor({ expiresAt: Date.now() - 1 }), eventId, adminId, 3),
    (error) => error.code === "DELETION_PREVIEW_EXPIRED",
  );
});

test("impact digest is deterministic and changes with deletion impact", () => {
  const left = __deletionTest.impactDigest({ counts: { reviews: 1, queues: 2 }, blockers: [] });
  const reordered = __deletionTest.impactDigest({ blockers: [], counts: { queues: 2, reviews: 1 } });
  const changed = __deletionTest.impactDigest({ counts: { reviews: 2, queues: 2 }, blockers: [] });
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
});
