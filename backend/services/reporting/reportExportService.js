const crypto = require("node:crypto");
const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { createAuditLog } = require("../../utils/logging/audit");
const { requireEventManager } = require("../event/eventAuthorizationService");
const { getCompletedEventAnalytics, resolveBounds } = require("./analyticsService");
const artifactStorage = require("./reportArtifactStorage");
const { renderReport } = require("./reportRenderer");

const DEFAULT_EXPIRY_HOURS = 7 * 24;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

const expiryHours = () => {
  const value = Number(process.env.REPORT_ARTIFACT_EXPIRY_HOURS || DEFAULT_EXPIRY_HOURS);
  return Number.isInteger(value) && value >= 1 && value <= 24 * 365 ? value : DEFAULT_EXPIRY_HOURS;
};

const serializeArtifact = (artifact) => artifact ? { artifactId: artifact.id, mimeType: artifact.mimeType, sizeBytes: Number(artifact.sizeBytes), sha256: artifact.sha256, expiresAt: artifact.expiresAt } : null;
const serializeJob = (job) => ({
  jobId: job.id, eventId: job.eventId, requestedById: job.requestedById, dataset: job.dataset, format: job.format,
  filters: job.filterSnapshot, status: job.status, attemptCount: job.attemptCount, maxAttempts: job.maxAttempts,
  failureCode: job.failureCode, requestedAt: job.requestedAt, generatedAt: job.generatedAt, expiresAt: job.expiresAt,
  artifact: serializeArtifact(job.artifact),
});

async function requireCompletedReportAccess(eventId, user, db) {
  const authorization = await requireEventManager(eventId, user, { db });
  if (authorization.event.status !== "COMPLETED") throw new AppError(409, "EVENT_NOT_COMPLETED", "Reports are available only for completed events");
  return authorization;
}

async function createReportJob(eventId, input, user, context, db = prisma, now = new Date()) {
  const authorization = await requireCompletedReportAccess(eventId, user, db);
  const bounds = resolveBounds(authorization.event, input.filters || {});
  const expiresAt = new Date(now.getTime() + expiryHours() * 60 * 60 * 1000);
  const job = await db.$transaction(async (tx) => {
    await requireCompletedReportAccess(eventId, user, tx);
    const created = await tx.reportExportJob.create({ data: { eventId, requestedById: user.userId, dataset: input.dataset, format: input.format, filterSnapshot: { from: bounds.from.toISOString(), to: bounds.to.toISOString() }, requestedAt: now, nextAttemptAt: now, expiresAt }, include: { artifact: true } });
    await createAuditLog({ userId: user.userId, action: "REPORT_EXPORT_QUEUED", entityName: "ReportExportJob", entityId: created.id, newValue: { eventId, dataset: input.dataset, format: input.format }, context, client: tx });
    return created;
  });
  return serializeJob(job);
}

async function listReportJobs(eventId, query, user, db = prisma) {
  await requireCompletedReportAccess(eventId, user, db);
  const jobs = await db.reportExportJob.findMany({ where: { eventId, ...(query.status ? { status: query.status } : {}) }, include: { artifact: true }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: query.limit });
  return { jobs: jobs.map(serializeJob) };
}

async function getReportJob(eventId, jobId, user, db = prisma) {
  await requireCompletedReportAccess(eventId, user, db);
  const job = await db.reportExportJob.findFirst({ where: { id: jobId, eventId }, include: { artifact: true } });
  if (!job) throw new AppError(404, "REPORT_JOB_NOT_FOUND", "Report export job was not found");
  return serializeJob(job);
}

async function claimNextReportJob({ db = prisma, now = new Date(), leaseMs = DEFAULT_LEASE_MS, eventId = null } = {}) {
  const claimToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const claimed = await db.$queryRaw(Prisma.sql`
    WITH candidate AS (
      SELECT report_export_job_id FROM report_export_jobs
      WHERE requested_by IS NOT NULL AND attempt_count < max_attempts AND expires_at > ${now}
        AND (${eventId}::uuid IS NULL OR event_id = ${eventId}::uuid)
        AND status IN ('QUEUED', 'FAILED') AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at, requested_at, report_export_job_id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE report_export_jobs j
    SET status = 'GENERATING', claim_token = ${claimToken}::uuid, lease_expires_at = ${leaseExpiresAt},
        attempt_count = j.attempt_count + 1, failure_code = NULL, updated_at = ${now}
    FROM candidate WHERE j.report_export_job_id = candidate.report_export_job_id
    RETURNING j.report_export_job_id AS id
  `);
  if (!claimed.length) return null;
  return db.reportExportJob.findUnique({ where: { id: claimed[0].id }, include: { artifact: true } });
}

const operationNow = ({ now, clock } = {}) => clock ? clock() : (now || new Date());
const ownedGeneratingWhere = (job, now) => ({ id: job.id, status: "GENERATING", claimToken: job.claimToken, leaseExpiresAt: { gt: now }, expiresAt: { gt: now } });

async function renewReportLease(job, { db = prisma, now, clock, leaseMs = DEFAULT_LEASE_MS } = {}) {
  const operationTime = operationNow({ now, clock });
  const changed = await db.reportExportJob.updateMany({ where: ownedGeneratingWhere(job, operationTime), data: { leaseExpiresAt: new Date(operationTime.getTime() + leaseMs) } });
  if (changed.count !== 1) throw new AppError(409, "REPORT_LEASE_LOST", "Report generation lease was lost");
}

const failureCode = (error) => String(error?.code || error?.name || "REPORT_GENERATION_FAILED").replace(/[^A-Z0-9_-]/gi, "_").toUpperCase().slice(0, 80);

async function reservePublication(job, storageKey, { db = prisma, now, clock, leaseMs = DEFAULT_LEASE_MS } = {}) {
  const operationTime = operationNow({ now, clock });
  const changed = await db.reportExportJob.updateMany({
    where: { ...ownedGeneratingWhere(job, operationTime), publicationStorageKey: null, publicationClaimToken: null },
    data: { publicationStorageKey: storageKey, publicationClaimToken: job.claimToken, leaseExpiresAt: new Date(operationTime.getTime() + leaseMs) },
  });
  if (changed.count !== 1) throw new AppError(409, "REPORT_LEASE_LOST", "Report generation lease was lost");
}

async function enqueueClaimArtifactCleanup(tx, job, storageKey) {
  if (!storageKey || !tx.artifactCleanupTask) return;
  await tx.artifactCleanupTask.createMany({ data: [{ eventId: job.eventId, artifactType: "REPORT_EXPORT", storageKey }], skipDuplicates: true });
}

async function failClaimedJob(job, error, { db = prisma, now, clock } = {}) {
  const operationTime = operationNow({ now, clock });
  const exhausted = job.attemptCount >= job.maxAttempts;
  const nextAttemptAt = new Date(operationTime.getTime() + Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, job.attemptCount - 1))));
  return db.$transaction(async (tx) => {
    const changed = await tx.reportExportJob.updateMany({
      where: ownedGeneratingWhere(job, operationTime),
      data: { status: "FAILED", claimToken: null, leaseExpiresAt: null, publicationStorageKey: null, publicationClaimToken: null, failureCode: failureCode(error), nextAttemptAt: exhausted ? job.expiresAt : nextAttemptAt },
    });
    if (changed.count !== 1) return false;
    await enqueueClaimArtifactCleanup(tx, job, job.publicationStorageKey);
    await createAuditLog({ userId: job.requestedById, action: "REPORT_EXPORT_GENERATION_FAILED", entityName: "ReportExportJob", entityId: job.id, outcome: "FAILED", newValue: { eventId: job.eventId, failureCode: failureCode(error), attemptCount: job.attemptCount, retryable: !exhausted, claimToken: job.claimToken }, client: tx });
    return true;
  });
}

async function processClaimedJob(job, { db = prisma, now, clock, leaseMs = DEFAULT_LEASE_MS, storage = artifactStorage, renderer = renderReport, afterStagingWritten, afterPublicationReserved, afterArtifactPublished } = {}) {
  let stagingKey;
  let finalKey;
  let publicationReserved = false;
  try {
    if (!job.requestedById) throw new AppError(409, "REPORT_REQUESTER_MISSING", "Report requester is required");
    const requester = await db.user.findUnique({ where: { id: job.requestedById }, select: { id: true, status: true, approvalState: true, accessState: true, deprovisionedAt: true } });
    if (!requester) throw new AppError(403, "REPORT_REQUESTER_UNAVAILABLE", "Report requester account is unavailable");
    const analytics = await getCompletedEventAnalytics(job.eventId, job.filterSnapshot, { ...requester, userId: requester.id }, db, now);
    const rendered = await renderer(analytics, job.dataset, job.format);
    await renewReportLease(job, { db, now, clock, leaseMs });
    stagingKey = storage.stagingStorageKey(job.eventId, job.id, job.format, job.claimToken);
    finalKey = storage.storageKey(job.eventId, job.id, job.format, job.claimToken);
    const stored = await storage.writeArtifact(stagingKey, rendered.contents, { db, now: operationNow({ now, clock }) });
    await afterStagingWritten?.({ job, stagingKey, finalKey });
    await reservePublication(job, finalKey, { db, now, clock, leaseMs });
    publicationReserved = true;
    await afterPublicationReserved?.({ job, stagingKey, finalKey });
    const completed = await db.$transaction(async (tx) => {
      const completionTime = operationNow({ now, clock });
      const owned = await tx.reportExportJob.updateMany({ where: { ...ownedGeneratingWhere(job, completionTime), publicationStorageKey: finalKey, publicationClaimToken: job.claimToken }, data: { leaseExpiresAt: new Date(completionTime.getTime() + leaseMs) } });
      if (owned.count !== 1) throw new AppError(409, "REPORT_LEASE_LOST", "Report generation lease was lost");
      await storage.publishArtifact(stagingKey, finalKey, { db: tx, now: completionTime });
      await afterArtifactPublished?.({ tx, job, stagingKey, finalKey });
      await tx.reportArtifact.upsert({ where: { jobId: job.id }, create: { jobId: job.id, storageKey: finalKey, mimeType: rendered.mimeType, sizeBytes: BigInt(stored.sizeBytes), sha256: stored.sha256, expiresAt: job.expiresAt }, update: { storageKey: finalKey, mimeType: rendered.mimeType, sizeBytes: BigInt(stored.sizeBytes), sha256: stored.sha256, expiresAt: job.expiresAt } });
      const changed = await tx.reportExportJob.updateMany({ where: { ...ownedGeneratingWhere(job, completionTime), publicationStorageKey: finalKey, publicationClaimToken: job.claimToken }, data: { status: "COMPLETED", generatedAt: completionTime, claimToken: null, leaseExpiresAt: null, publicationStorageKey: null, publicationClaimToken: null, failureCode: null } });
      if (changed.count !== 1) throw new AppError(409, "REPORT_LEASE_LOST", "Report generation lease was lost");
      await createAuditLog({ userId: job.requestedById, action: "REPORT_EXPORT_GENERATED", entityName: "ReportExportJob", entityId: job.id, newValue: { eventId: job.eventId, dataset: job.dataset, format: job.format, sha256: stored.sha256, sizeBytes: stored.sizeBytes, claimToken: job.claimToken }, client: tx });
      return tx.reportExportJob.findUnique({ where: { id: job.id }, include: { artifact: true } });
    });
    stagingKey = null;
    publicationReserved = false;
    return { status: "COMPLETED", job: serializeJob(completed) };
  } catch (error) {
    if (stagingKey) await storage.deleteArtifact(stagingKey, { db }).catch(() => {});
    if (publicationReserved && finalKey) await storage.deleteArtifact(finalKey, { db }).catch(() => {}); // Claim keys are immutable; this can never delete another worker's artifact.
    if (error.code === "REPORT_LEASE_LOST") return { status: "LEASE_LOST" };
    const changed = await failClaimedJob({ ...job, publicationStorageKey: publicationReserved ? finalKey : null }, error, { db, now, clock });
    if (!changed) return { status: "LEASE_LOST" };
    return { status: "FAILED", retryable: job.attemptCount < job.maxAttempts, failureCode: failureCode(error) };
  }
}

async function processNextReportJob(options = {}) {
  const job = await claimNextReportJob(options);
  return job ? processClaimedJob(job, options) : null;
}

async function downloadReportArtifact(eventId, jobId, user, context, db = prisma, now = new Date()) {
  await requireCompletedReportAccess(eventId, user, db);
  const job = await db.reportExportJob.findFirst({ where: { id: jobId, eventId }, include: { artifact: true } });
  if (!job) throw new AppError(404, "REPORT_JOB_NOT_FOUND", "Report export job was not found");
  if (job.status !== "COMPLETED" || !job.artifact) throw new AppError(409, "REPORT_NOT_READY", "Report artifact is not ready");
  if (job.expiresAt <= now || job.artifact.expiresAt <= now) throw new AppError(410, "REPORT_EXPIRED", "Report artifact has expired");
  let artifact;
  try { artifact = await artifactStorage.readArtifact(job.artifact.storageKey, { db }); } catch (error) {
    if (error.code === "ENOENT") throw new AppError(410, "REPORT_ARTIFACT_MISSING", "Report artifact is no longer available");
    throw error;
  }
  if (artifact.sha256.length !== job.artifact.sha256.length || !crypto.timingSafeEqual(Buffer.from(artifact.sha256), Buffer.from(job.artifact.sha256))) throw new AppError(409, "REPORT_HASH_MISMATCH", "Report artifact integrity verification failed");
  await createAuditLog({ userId: user.userId, action: "REPORT_EXPORT_DOWNLOADED", entityName: "ReportExportJob", entityId: job.id, newValue: { eventId, sha256: artifact.sha256 }, context, client: db });
  return { contents: artifact.contents, mimeType: job.artifact.mimeType, filename: `${eventId}-${job.dataset.toLowerCase()}.${job.format.toLowerCase()}`, sha256: artifact.sha256 };
}

async function recoverExpiredReportJobs({ db = prisma, now = new Date() } = {}) {
  const candidates = await db.reportExportJob.findMany({
    where: { status: "GENERATING", OR: [{ expiresAt: { lte: now } }, { leaseExpiresAt: { lte: now } }] },
    select: { id: true, eventId: true, requestedById: true, claimToken: true, publicationStorageKey: true, expiresAt: true, attemptCount: true, maxAttempts: true, leaseExpiresAt: true, format: true },
  });
  const recovered = { expired: 0, exhausted: 0, requeued: 0 };
  for (const job of candidates) {
    await db.$transaction(async (tx) => {
      const isExpired = job.expiresAt <= now;
      const exhausted = !isExpired && job.attemptCount >= job.maxAttempts;
      const changed = await tx.reportExportJob.updateMany({
        where: { id: job.id, status: "GENERATING", claimToken: job.claimToken, ...(isExpired ? { expiresAt: { lte: now } } : { leaseExpiresAt: { lte: now }, expiresAt: { gt: now } }) },
        data: isExpired
          ? { status: "EXPIRED", claimToken: null, leaseExpiresAt: null, publicationStorageKey: null, publicationClaimToken: null, failureCode: "REPORT_EXPIRED" }
          : exhausted
            ? { status: "FAILED", claimToken: null, leaseExpiresAt: null, publicationStorageKey: null, publicationClaimToken: null, failureCode: "REPORT_LEASE_EXPIRED" }
            : { status: "QUEUED", claimToken: null, leaseExpiresAt: null, publicationStorageKey: null, publicationClaimToken: null, nextAttemptAt: now, failureCode: "REPORT_LEASE_RECOVERED" },
      });
      if (!changed.count) return;
      await enqueueClaimArtifactCleanup(tx, job, job.publicationStorageKey);
      if (job.claimToken) await enqueueClaimArtifactCleanup(tx, job, artifactStorage.stagingStorageKey(job.eventId, job.id, job.format, job.claimToken));
      if (isExpired) recovered.expired += 1;
      else if (exhausted) recovered.exhausted += 1;
      else recovered.requeued += 1;
    });
  }
  return recovered;
}

async function expireReportArtifacts({ db = prisma, now = new Date(), limit = 100 } = {}) {
  const recovery = await recoverExpiredReportJobs({ db, now });
  const staleBlobs = await artifactStorage.cleanupReportArtifactBlobs({ db, now, limit });
  const artifacts = await db.reportArtifact.findMany({ where: { expiresAt: { lte: now } }, include: { job: true }, orderBy: { expiresAt: "asc" }, take: Math.min(Math.max(limit, 1), 500) });
  let expired = 0;
  let failed = 0;
  for (const artifact of artifacts) {
    try {
      await artifactStorage.deleteArtifact(artifact.storageKey, { db });
      await db.$transaction(async (tx) => {
        await tx.reportArtifact.deleteMany({ where: { id: artifact.id, expiresAt: { lte: now } } });
        await tx.reportExportJob.updateMany({ where: { id: artifact.jobId, status: "COMPLETED" }, data: { status: "EXPIRED" } });
      });
      expired += 1;
    } catch (_error) { failed += 1; }
  }
  await db.reportExportJob.updateMany({ where: { expiresAt: { lte: now }, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "EXPIRED", claimToken: null, leaseExpiresAt: null } });
  return { inspected: artifacts.length, expired, failed, recovery, staleBlobs };
}

module.exports = { DEFAULT_LEASE_MS, claimNextReportJob, createReportJob, downloadReportArtifact, expireReportArtifacts, failureCode, getReportJob, listReportJobs, processClaimedJob, processNextReportJob, recoverExpiredReportJobs, renewReportLease, requireCompletedReportAccess, serializeJob };
