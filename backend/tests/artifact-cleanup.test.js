const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { storeSignature } = require("../utils/signatureStorage");
const {
  TYPES,
  collectEventArtifactTasks,
  documentPathForKey,
  listArtifactCleanupTasks,
  maintainArtifactCleanupTask,
  processArtifactCleanupTasks,
  removeTaskArtifact,
} = require("../services/artifactCleanupService");

const png = () => {
  const buffer = Buffer.alloc(128);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return buffer;
};

test("event cleanup validates event ownership and cannot delete another event signature", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-cleanup-signature-"));
  const prior = process.env.SIGNATURE_STORAGE_DIR;
  process.env.SIGNATURE_STORAGE_DIR = root;
  t.after(() => {
    if (prior === undefined) delete process.env.SIGNATURE_STORAGE_DIR;
    else process.env.SIGNATURE_STORAGE_DIR = prior;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ownerId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const otherEventId = crypto.randomUUID();
  const stored = await storeSignature(png(), "image/png", ownerId, eventId, "CONSENT");

  await assert.rejects(
    removeTaskArtifact({ artifactType: TYPES.CONSENT_SIGNATURE, storageKey: stored.signatureObjectKey, eventId: otherEventId }),
    (error) => error.code === "INVALID_SIGNATURE",
  );
  assert.equal(fs.existsSync(path.join(root, ownerId, path.basename(stored.signatureObjectKey))), true);
  assert.equal(await removeTaskArtifact({ artifactType: TYPES.CONSENT_SIGNATURE, storageKey: stored.signatureObjectKey, eventId }), true);
  assert.equal(await removeTaskArtifact({ artifactType: TYPES.CONSENT_SIGNATURE, storageKey: stored.signatureObjectKey, eventId }), false);
});

test("event cleanup rejects an artifact key owned outside the event before enqueue", async () => {
  const eventId = crypto.randomUUID();
  const otherEventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const foreignKey = `signatures/${userId}/consent-${otherEventId}-${crypto.randomUUID()}.png`;
  const tx = {
    participantConsent: { findMany: async () => [{ signatureObjectKey: foreignKey }] },
    referral: { findMany: async () => [] },
    signatureArtifact: { findMany: async () => [] },
    documentArtifact: { findMany: async () => [], findFirst: async () => null },
  };
  await assert.rejects(
    collectEventArtifactTasks(tx, eventId),
    (error) => error.code === "INVALID_SIGNATURE",
  );
});

test("failed cleanup stays in a retryable outbox state without leaking paths", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-cleanup-document-"));
  const prior = process.env.REFERRAL_STORAGE_DIR;
  process.env.REFERRAL_STORAGE_DIR = root;
  t.after(() => {
    if (prior === undefined) delete process.env.REFERRAL_STORAGE_DIR;
    else process.env.REFERRAL_STORAGE_DIR = prior;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const task = {
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    artifactType: TYPES.REFERRAL_DOCUMENT,
    storageKey: `documents/${crypto.randomUUID()}.pdf`,
    status: "PENDING",
    attemptCount: 0,
    createdAt: new Date(),
  };
  fs.mkdirSync(documentPathForKey(task.storageKey));
  const updates = [];
  const db = { artifactCleanupTask: {
    findMany: async () => [task],
    updateMany: async () => ({ count: 1 }),
    update: async ({ data }) => { updates.push(data); return {}; },
  } };

  const result = await processArtifactCleanupTasks({ db, now: new Date() });
  assert.deepEqual(result, { inspected: 1, completed: 0, failed: 1, escalated: 0 });
  assert.equal(updates[0].status, "FAILED");
  assert.equal(updates[0].lastError, "UNSAFE_ARTIFACT_PATH");
  assert.equal(updates[0].lastError.includes(root), false);
});

test("an exhausted cleanup task is escalated and audited instead of silently dead-ending", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-cleanup-escalated-"));
  const prior = process.env.REFERRAL_STORAGE_DIR;
  process.env.REFERRAL_STORAGE_DIR = root;
  t.after(() => {
    if (prior === undefined) delete process.env.REFERRAL_STORAGE_DIR;
    else process.env.REFERRAL_STORAGE_DIR = prior;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const task = {
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    artifactType: TYPES.REFERRAL_DOCUMENT,
    storageKey: `documents/${crypto.randomUUID()}.pdf`,
    status: "FAILED",
    attemptCount: 9,
    createdAt: new Date(),
  };
  fs.mkdirSync(documentPathForKey(task.storageKey));
  const writes = [];
  const audits = [];
  const db = {
    artifactCleanupTask: {
      findMany: async () => [task],
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => { writes.push(data); return { ...task, ...data, attemptCount: 10 }; },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };

  const result = await processArtifactCleanupTasks({ db, now: new Date() });
  assert.deepEqual(result, { inspected: 1, completed: 0, failed: 0, escalated: 1 });
  assert.equal(writes[0].status, "ESCALATED");
  assert.equal(audits[0].action, "ARTIFACT_CLEANUP_ESCALATED");
  assert.equal(JSON.stringify(audits[0]).includes(root), false);
});

test("administrators can list and explicitly requeue or resolve escalated cleanup tasks", async () => {
  const task = {
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    artifactType: TYPES.REFERRAL_DOCUMENT,
    storageKey: `documents/${crypto.randomUUID()}.pdf`,
    status: "ESCALATED",
    attemptCount: 10,
    lastError: "EACCES",
    nextAttemptAt: new Date(),
    claimedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const admin = { userId: crypto.randomUUID(), roles: ["ADMINISTRATOR"] };
  await assert.rejects(
    listArtifactCleanupTasks({ status: "ESCALATED", limit: 100 }, { userId: crypto.randomUUID(), roles: ["SUPPORT"] }, {}),
    (error) => error.status === 403,
  );
  const listed = await listArtifactCleanupTasks(
    { status: "ESCALATED", limit: 100 },
    admin,
    { artifactCleanupTask: { findMany: async () => [task] } },
  );
  assert.equal(listed.tasks[0].taskId, task.id);
  assert.equal(Object.hasOwn(listed.tasks[0], "storageKey"), false);

  for (const action of ["REQUEUE", "RESOLVE"]) {
    let updateData;
    const audits = [];
    const updated = {
      ...task,
      status: action === "REQUEUE" ? "PENDING" : "RESOLVED",
      attemptCount: action === "REQUEUE" ? 0 : 10,
    };
    const tx = {
      artifactCleanupTask: {
        findUnique: async () => task,
        updateMany: async ({ data }) => { updateData = data; return { count: 1 }; },
        findUniqueOrThrow: async () => updated,
      },
      auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    };
    // Service uses a second findUnique after the state claim.
    let reads = 0;
    tx.artifactCleanupTask.findUnique = async () => (++reads === 1 ? task : updated);
    const result = await maintainArtifactCleanupTask(
      task.id,
      { action, resolutionNote: "Administrator confirmed recovery action" },
      admin,
      "127.0.0.1",
      { $transaction: async (work) => work(tx) },
    );
    assert.equal(result.status, updated.status);
    assert.equal(audits[0].action, action === "REQUEUE" ? "ARTIFACT_CLEANUP_REQUEUED" : "ARTIFACT_CLEANUP_RESOLVED");
    if (action === "REQUEUE") assert.equal(updateData.attemptCount, 0);
  }
});
