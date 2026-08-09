const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { after, before, test } = require("node:test");
const reportRoot = path.join(__dirname, "../../secure-data", `vsms-reports-${crypto.randomUUID()}`);
process.env.REPORT_STORAGE_DIR = reportRoot;
const prisma = require("../../prisma/prismaClient");
const { getCompletedEventAnalytics } = require("../../services/reporting/analyticsService");
const { createReportJob, downloadReportArtifact, processClaimedJob, claimNextReportJob, recoverExpiredReportJobs } = require("../../services/reporting/reportExportService");
const { processArtifactCleanupTasks } = require("../../services/platform/artifactCleanupService");
const { readArtifact, stagingStorageKey, storageKey, writeArtifact } = require("../../services/reporting/reportArtifactStorage");
const { maintainLifecycleEmail, processClaimedLifecycleEmail, reconcileStaleLifecycleEmails } = require("../../services/account/accountLifecycleNotificationService");

let event;
let manager;

before(async () => {
  manager = await prisma.user.create({
    data: {
      fullName: "Analytics Integration Manager",
      email: `${crypto.randomUUID()}@analytics.test`,
      status: "ACTIVE",
      approvalState: "APPROVED",
      accessState: "ENABLED",
    },
  });
  event = await prisma.event.create({
    data: {
      name: `Completed analytics ${crypto.randomUUID()}`,
      venue: "Analytics Hall",
      timezone: "Asia/Singapore",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-01-01T08:00:00.000Z"),
      capacity: 20,
      status: "COMPLETED",
      createdByUserId: manager.id,
      memberships: {
        create: {
          userId: manager.id,
          addedById: manager.id,
          roles: { create: { role: "EVENT_MANAGER", assignedById: manager.id } },
        },
      },
    },
  });
});

after(async () => {
  if (event) await prisma.event.delete({ where: { eventId: event.eventId } });
  if (manager) await prisma.lifecycleEmailOutbox.deleteMany({ where: { userId: manager.id } });
  await fs.rm(reportRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

test("CSV report generation persists a verified artifact and download rechecks membership", async () => {
  const user = { userId: manager.id, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
  const queued = await createReportJob(event.eventId, {
    dataset: "OVERVIEW",
    format: "CSV",
    filters: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T08:00:00.000Z" },
  }, user, {});
  const claimToken = crypto.randomUUID();
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "GENERATING", claimToken, attemptCount: 1, leaseExpiresAt: new Date(Date.now() + 60_000) } });
  const claimed = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId }, include: { artifact: true } });
  const result = await processClaimedJob(claimed);
  assert.equal(result.status, "COMPLETED");
  const download = await downloadReportArtifact(event.eventId, queued.jobId, user, {});
  assert.equal(download.mimeType, "text/csv; charset=utf-8");
  assert.equal(crypto.createHash("sha256").update(download.contents).digest("hex"), download.sha256);
  assert.equal(download.contents.includes(Buffer.from("participantId")), false);

  await prisma.eventMembership.updateMany({
    where: { eventId: event.eventId, userId: manager.id },
    data: { status: "REMOVED", removedById: manager.id, removedAt: new Date(), removalReason: "Permission recheck integration test" },
  });
  await assert.rejects(
    downloadReportArtifact(event.eventId, queued.jobId, user, {}),
    (error) => error.code === "EVENT_ROLE_REQUIRED",
  );
  await prisma.eventMembership.updateMany({
    where: { eventId: event.eventId, userId: manager.id },
    data: { status: "ACTIVE", removedById: null, removedAt: null, removalReason: null },
  });
});

test("completed-event analytics executes bounded PostgreSQL aggregates without identities", async () => {
  const analytics = await getCompletedEventAnalytics(
    event.eventId,
    { from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T08:00:00.000Z" },
    { userId: manager.id, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" },
  );
  assert.equal(analytics.aggregateOnly, true);
  assert.equal(analytics.event.timezone, "Asia/Singapore");
  assert.equal(analytics.tables.find(({ id }) => id === "registrations").rows[0].attendance, 0);
  assert.equal(JSON.stringify(analytics).includes("participantId"), false);
  assert.match(analytics.metricDefinitions.find(({ key }) => key === "queueWaitP90").definition, /percentile_cont\(0\.90\)/);
});

test("an expired report owner cannot renew, publish, or fail the claim before recovery", async () => {
  const user = { userId: manager.id, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
  const queued = await createReportJob(event.eventId, { dataset: "OVERVIEW", format: "CSV", filters: {} }, user, {});
  const claimToken = crypto.randomUUID();
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "GENERATING", claimToken, attemptCount: 1, leaseExpiresAt: new Date(Date.now() - 1_000) } });
  const stale = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId }, include: { artifact: true } });
  assert.deepEqual(await processClaimedJob(stale), { status: "LEASE_LOST" });
  const unchanged = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId } });
  assert.equal(unchanged.status, "GENERATING");
  assert.equal(unchanged.claimToken, claimToken);
  assert.equal(unchanged.publicationStorageKey, null);
  assert.equal((await recoverExpiredReportJobs()).requeued, 1);
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "CANCELLED", claimToken: null, leaseExpiresAt: null } });
});

test("a pre-publish reservation survives recovery and fences a stale worker without an orphan", async () => {
  const user = { userId: manager.id, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
  const queued = await createReportJob(event.eventId, { dataset: "OVERVIEW", format: "CSV", filters: {} }, user, {});
  const staleToken = crypto.randomUUID();
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "GENERATING", claimToken: staleToken, attemptCount: 1, leaseExpiresAt: new Date(Date.now() + 30_000) } });
  const stale = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId }, include: { artifact: true } });
  let enteredResolve;
  let release;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const staleWorker = processClaimedJob(stale, {
    afterPublicationReserved: async () => {
      enteredResolve();
      await held;
    },
  });
  await entered;
  const staleFinalKey = storageKey(event.eventId, queued.jobId, "CSV", staleToken);
  const reserved = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId } });
  assert.equal(reserved.publicationStorageKey, staleFinalKey);
  assert.equal(reserved.publicationClaimToken, staleToken);
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } });
  const recovery = await recoverExpiredReportJobs();
  assert.equal(recovery.requeued, 1);
  assert.equal(await prisma.artifactCleanupTask.count({ where: { eventId: event.eventId, artifactType: "REPORT_EXPORT", storageKey: staleFinalKey } }), 1);
  const winner = await claimNextReportJob({ eventId: event.eventId });
  assert.ok(winner);
  assert.notEqual(winner.claimToken, staleToken);
  const winnerResult = await processClaimedJob(winner);
  assert.equal(winnerResult.status, "COMPLETED", JSON.stringify(winnerResult));
  const completedBeforeRelease = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId }, include: { artifact: true } });
  assert.ok(completedBeforeRelease.artifact, JSON.stringify(winnerResult));
  assert.equal(completedBeforeRelease.artifact.storageKey.includes(winner.claimToken), true);
  const artifactRead = await readArtifact(completedBeforeRelease.artifact.storageKey);
  assert.ok(artifactRead.contents.length > 0);
  release();
  assert.deepEqual(await staleWorker, { status: "LEASE_LOST" });
  const completed = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId }, include: { artifact: true } });
  assert.equal(completed.artifact.storageKey, completedBeforeRelease.artifact.storageKey);
  await assert.rejects(readArtifact(staleFinalKey), { code: "ENOENT" });
  await assert.rejects(readArtifact(stagingStorageKey(event.eventId, queued.jobId, "CSV", staleToken)), { code: "ENOENT" });
});

test("crash after staging before reservation is recovered by cleanup worker", async () => {
  const user = { userId: manager.id, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
  const queued = await createReportJob(event.eventId, { dataset: "OVERVIEW", format: "CSV", filters: {} }, user, {});
  const claimToken = crypto.randomUUID();
  const stageKey = stagingStorageKey(event.eventId, queued.jobId, "CSV", claimToken);
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "GENERATING", claimToken, attemptCount: 1, leaseExpiresAt: new Date(Date.now() - 1_000) } });
  await writeArtifact(stageKey, Buffer.from("sensitive staged report"));
  assert.equal((await readArtifact(stageKey)).contents.toString("utf8"), "sensitive staged report");
  const recovery = await recoverExpiredReportJobs();
  assert.equal(recovery.requeued, 1);
  assert.equal(await prisma.artifactCleanupTask.count({ where: { eventId: event.eventId, artifactType: "REPORT_EXPORT", storageKey: stageKey } }), 1);
  const cleanup = await processArtifactCleanupTasks({ eventId: event.eventId });
  assert.ok(cleanup.completed >= 1, JSON.stringify(cleanup));
  await assert.rejects(readArtifact(stageKey), { code: "ENOENT" });
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "CANCELLED", claimToken: null, leaseExpiresAt: null } });
});

test("publish inside completion transaction rolls back final blobs on audit failure", async () => {
  const user = { userId: manager.id, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
  const queued = await createReportJob(event.eventId, { dataset: "OVERVIEW", format: "CSV", filters: {} }, user, {});
  const claimToken = crypto.randomUUID();
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "GENERATING", claimToken, attemptCount: 1, leaseExpiresAt: new Date(Date.now() + 30_000) } });
  const claimed = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId }, include: { artifact: true } });
  const finalKey = storageKey(event.eventId, queued.jobId, "CSV", claimToken);
  const stageKey = stagingStorageKey(event.eventId, queued.jobId, "CSV", claimToken);
  const result = await processClaimedJob(claimed, {
    afterArtifactPublished: async () => { throw Object.assign(new Error("simulated crash after publish"), { code: "SIMULATED_AUDIT_FAILURE" }); },
  });
  assert.equal(result.status, "FAILED", JSON.stringify(result));
  await assert.rejects(readArtifact(finalKey), { code: "ENOENT" });
  await assert.rejects(readArtifact(stageKey), { code: "ENOENT" });
  const failed = await prisma.reportExportJob.findUniqueOrThrow({ where: { id: queued.jobId } });
  assert.equal(failed.status, "FAILED");
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "CANCELLED", claimToken: null, leaseExpiresAt: null } });
});

test("two PostgreSQL workers claim one queued export exactly once", async () => {
  const user = { userId: manager.id, status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
  const queued = await createReportJob(event.eventId, { dataset: "OPERATIONS", format: "CSV", filters: {} }, user, {});
  const claims = await Promise.all([claimNextReportJob({ eventId: event.eventId }), claimNextReportJob({ eventId: event.eventId })]);
  const claimed = claims.filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, queued.jobId);
  await prisma.reportExportJob.update({ where: { id: queued.jobId }, data: { status: "CANCELLED", claimToken: null, leaseExpiresAt: null } });
});

test("SMTP ambiguity and restart recovery require audited manual reconciliation", async () => {
  const ambiguous = await prisma.lifecycleEmailOutbox.create({ data: { userId: manager.id, purpose: "APPROVED", idempotencyKey: `ambiguous-${crypto.randomUUID()}`, status: "SENDING", claimToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 30_000), attemptCount: 1 } });
  const delivery = await prisma.lifecycleEmailOutbox.findUniqueOrThrow({ where: { id: ambiguous.id }, include: { user: { select: { id: true, email: true, fullName: true } } } });
  const result = await processClaimedLifecycleEmail(delivery, { transport: { sendMail: async () => { const error = new Error("connection lost after DATA"); error.code = "ETIMEDOUT"; throw error; } } });
  assert.equal(result.status, "RECONCILIATION_REQUIRED");
  assert.equal((await prisma.lifecycleEmailOutbox.findUniqueOrThrow({ where: { id: ambiguous.id } })).status, "RECONCILIATION_REQUIRED");
  await maintainLifecycleEmail(ambiguous.id, "REQUEUE", "Verified provider logs; safe to retry", manager.id, {});
  assert.equal((await prisma.lifecycleEmailOutbox.findUniqueOrThrow({ where: { id: ambiguous.id } })).status, "QUEUED");

  const crashed = await prisma.lifecycleEmailOutbox.create({ data: { userId: manager.id, purpose: "APPROVED", idempotencyKey: `crashed-${crypto.randomUUID()}`, status: "SENDING", claimToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000), attemptCount: 1 } });
  assert.ok((await reconcileStaleLifecycleEmails()).escalated >= 1);
  assert.equal((await prisma.lifecycleEmailOutbox.findUniqueOrThrow({ where: { id: crashed.id } })).status, "ESCALATED");
});
