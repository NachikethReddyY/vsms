const fs = require("fs/promises");
const path = require("path");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { deleteEventSignature, signatureMetadata } = require("../utils/signatureStorage");

const TYPES = Object.freeze({
  CONSENT_SIGNATURE: "CONSENT_SIGNATURE",
  REFERRAL_SIGNATURE: "REFERRAL_SIGNATURE",
  REFERRAL_DOCUMENT: "REFERRAL_DOCUMENT",
});
const DOCUMENT_KEY = /^documents\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.pdf)$/;
const MAX_ATTEMPTS = 10;
const STALE_CLAIM_MS = 10 * 60 * 1000;

const documentsRoot = () => path.resolve(
  process.env.REFERRAL_STORAGE_DIR || path.join(__dirname, "..", "secure-data", "documents"),
);

const documentPathForKey = (storageKey) => {
  const match = DOCUMENT_KEY.exec(storageKey || "");
  if (!match) throw new AppError(422, "INVALID_ARTIFACT_PATH", "Referral document metadata is invalid");
  const root = documentsRoot();
  const filePath = path.resolve(root, match[1]);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new AppError(422, "INVALID_ARTIFACT_PATH", "Referral document metadata is invalid");
  }
  return filePath;
};

const deleteRegularFile = async (filePath) => {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new AppError(409, "UNSAFE_ARTIFACT_PATH", "Artifact is not a regular file");
    }
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const uniqueTasks = (eventId, entries) => [...new Map(entries.map((entry) => [
  `${entry.artifactType}:${entry.storageKey}`,
  { eventId, ...entry },
])).values()];

const collectEventArtifactTasks = async (tx, eventId) => {
  const [consents, referrals, signatures, documents] = await Promise.all([
    tx.participantConsent.findMany({
      where: { eventId, signatureObjectKey: { not: null } },
      select: { signatureObjectKey: true },
    }),
    tx.referral.findMany({
      where: { review: { registration: { eventId } }, signatureObjectKey: { not: null } },
      select: { signatureObjectKey: true },
    }),
    tx.signatureArtifact.findMany({
      where: { eventId },
      select: { purpose: true, signatureObjectKey: true },
    }),
    tx.documentArtifact.findMany({
      where: { review: { registration: { eventId } } },
      select: { storageKey: true },
    }),
  ]);

  const entries = [
    ...consents.map(({ signatureObjectKey }) => ({ artifactType: TYPES.CONSENT_SIGNATURE, storageKey: signatureObjectKey })),
    ...referrals.map(({ signatureObjectKey }) => ({ artifactType: TYPES.REFERRAL_SIGNATURE, storageKey: signatureObjectKey })),
    ...signatures.map(({ purpose, signatureObjectKey }) => ({
      artifactType: purpose === "REFERRAL" ? TYPES.REFERRAL_SIGNATURE : TYPES.CONSENT_SIGNATURE,
      storageKey: signatureObjectKey,
    })),
    ...documents.map(({ storageKey }) => ({ artifactType: TYPES.REFERRAL_DOCUMENT, storageKey })),
  ];

  for (const entry of entries) {
    if ([TYPES.CONSENT_SIGNATURE, TYPES.REFERRAL_SIGNATURE].includes(entry.artifactType)) {
      signatureMetadata(entry.storageKey, eventId);
    } else {
      documentPathForKey(entry.storageKey);
    }
  }

  const documentKeys = documents.map(({ storageKey }) => storageKey);
  if (documentKeys.length) {
    const outsideOwner = await tx.documentArtifact.findFirst({
      where: {
        storageKey: { in: documentKeys },
        NOT: { review: { registration: { eventId } } },
      },
      select: { documentId: true },
    });
    if (outsideOwner) {
      throw new AppError(409, "EVENT_DELETE_INTEGRITY_CONFLICT", "An event artifact is referenced outside this event");
    }
  }

  return uniqueTasks(eventId, entries);
};

const enqueueEventArtifactCleanup = async (tx, eventId) => {
  const tasks = await collectEventArtifactTasks(tx, eventId);
  if (!tasks.length) return 0;
  const result = await tx.artifactCleanupTask.createMany({ data: tasks, skipDuplicates: true });
  return result.count;
};

const removeTaskArtifact = async (task) => {
  if ([TYPES.CONSENT_SIGNATURE, TYPES.REFERRAL_SIGNATURE].includes(task.artifactType)) {
    return deleteEventSignature(task.storageKey, task.eventId);
  }
  if (task.artifactType === TYPES.REFERRAL_DOCUMENT) {
    return deleteRegularFile(documentPathForKey(task.storageKey));
  }
  throw new AppError(422, "UNKNOWN_ARTIFACT_TYPE", "Cleanup artifact type is invalid");
};

const safeFailureCode = (error) => String(error?.code || "ARTIFACT_CLEANUP_FAILED")
  .replace(/[^A-Z0-9_-]/gi, "_")
  .slice(0, 255);

const assertAdministrator = (user) => {
  if (!user?.roles?.includes("ADMINISTRATOR")) {
    throw new AppError(403, "ADMINISTRATOR_REQUIRED", "Administrator access is required");
  }
};

const serializeTask = (task) => ({
  taskId: task.id,
  eventId: task.eventId,
  artifactType: task.artifactType,
  status: task.status,
  attemptCount: task.attemptCount,
  lastError: task.lastError,
  nextAttemptAt: task.nextAttemptAt,
  claimedAt: task.claimedAt,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

const auditTask = (db, { task, userId = null, action, outcome, details = {}, ipAddress = null }) => db.auditLog.create({ data: {
  userId,
  action,
  resource: "ArtifactCleanupTask",
  entityName: "ArtifactCleanupTask",
  entityId: task.id,
  outcome,
  details: { eventId: task.eventId, artifactType: task.artifactType, attemptCount: task.attemptCount, ...details },
  ipAddress: String(ipAddress || "").slice(0, 45) || null,
} });

const processArtifactCleanupTasks = async ({ eventId = null, limit = 100, db = prisma, now = new Date() } = {}) => {
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const candidates = await db.artifactCleanupTask.findMany({
    where: {
      ...(eventId ? { eventId } : {}),
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
        { status: "PROCESSING", claimedAt: { lte: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 500),
  });

  const result = { inspected: candidates.length, completed: 0, failed: 0, escalated: 0 };
  for (const task of candidates) {
    const claimed = await db.artifactCleanupTask.updateMany({
      where: {
        id: task.id,
        attemptCount: { lt: MAX_ATTEMPTS },
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
          { status: "PROCESSING", claimedAt: { lte: staleBefore } },
        ],
      },
      data: { status: "PROCESSING", claimedAt: now, attemptCount: { increment: 1 }, lastError: null },
    });
    if (claimed.count !== 1) continue;

    try {
      await removeTaskArtifact(task);
      await db.artifactCleanupTask.update({
        where: { id: task.id },
        data: { status: "COMPLETED", completedAt: new Date(), claimedAt: null, lastError: null },
      });
      result.completed += 1;
    } catch (error) {
      const attemptCount = task.attemptCount + 1;
      const escalated = attemptCount >= MAX_ATTEMPTS;
      const nextAttemptAt = new Date(now.getTime() + Math.min(60 * 60 * 1000, 2 ** task.attemptCount * 30_000));
      const updated = await db.artifactCleanupTask.update({
        where: { id: task.id },
        data: { status: escalated ? "ESCALATED" : "FAILED", claimedAt: null, lastError: safeFailureCode(error), nextAttemptAt },
      });
      if (escalated) {
        await auditTask(db, {
          task: { ...task, ...updated, attemptCount },
          action: "ARTIFACT_CLEANUP_ESCALATED",
          outcome: "FAILED",
          details: { failureCode: safeFailureCode(error) },
        });
        result.escalated += 1;
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
};

const listArtifactCleanupTasks = async (query, user, db = prisma) => {
  assertAdministrator(user);
  const tasks = await db.artifactCleanupTask.findMany({
    where: {
      status: query.status,
      ...(query.eventId ? { eventId: query.eventId } : {}),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: query.limit,
  });
  return { tasks: tasks.map(serializeTask) };
};

const maintainArtifactCleanupTask = async (taskId, input, user, ipAddress, db = prisma, now = new Date()) => {
  assertAdministrator(user);
  return db.$transaction(async (tx) => {
    const task = await tx.artifactCleanupTask.findUnique({ where: { id: taskId } });
    if (!task) throw new AppError(404, "ARTIFACT_CLEANUP_TASK_NOT_FOUND", "Artifact cleanup task was not found");
    if (task.status !== "ESCALATED") {
      throw new AppError(409, "ARTIFACT_CLEANUP_TASK_NOT_ESCALATED", "Only an escalated cleanup task can be requeued or resolved");
    }
    const data = input.action === "REQUEUE"
      ? { status: "PENDING", attemptCount: 0, nextAttemptAt: now, claimedAt: null, completedAt: null, lastError: null }
      : { status: "RESOLVED", claimedAt: null, completedAt: now };
    const changed = await tx.artifactCleanupTask.updateMany({ where: { id: taskId, status: "ESCALATED" }, data });
    if (changed.count !== 1) throw new AppError(409, "ARTIFACT_CLEANUP_STATE_CONFLICT", "Artifact cleanup task changed concurrently");
    const updated = await tx.artifactCleanupTask.findUnique({ where: { id: taskId } });
    await auditTask(tx, {
      task: updated,
      userId: user.userId,
      action: input.action === "REQUEUE" ? "ARTIFACT_CLEANUP_REQUEUED" : "ARTIFACT_CLEANUP_RESOLVED",
      outcome: "SUCCESS",
      details: { resolutionNote: input.resolutionNote },
      ipAddress,
    });
    return serializeTask(updated);
  });
};

module.exports = {
  TYPES,
  documentPathForKey,
  collectEventArtifactTasks,
  enqueueEventArtifactCleanup,
  processArtifactCleanupTasks,
  listArtifactCleanupTasks,
  maintainArtifactCleanupTask,
  removeTaskArtifact,
};
