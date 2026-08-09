const crypto = require("node:crypto");
const AppError = require("../../errors/AppError");
const prisma = require("../../prisma/prismaClient");

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const LEGACY_KEY_PATTERN = new RegExp(`^${UUID}/${UUID}\\.(pdf|csv)$`);
const ARTIFACT_KEY_PATTERN = new RegExp(`^claim-${UUID}\\.(pdf|csv)$`);
const STAGING_KEY_PATTERN = new RegExp(`^claim-${UUID}\\.(pdf|csv)\\.stage$`);
const KEY_PATTERN = new RegExp(`(?:${LEGACY_KEY_PATTERN.source}|${ARTIFACT_KEY_PATTERN.source}|${STAGING_KEY_PATTERN.source})`);
const UUID_PATTERN = new RegExp(`^${UUID}$`);

const storageRoot = () => "report-artifact-blobs";
const unsafe = (message = "Report artifact storage is unsafe") => new AppError(409, "UNSAFE_REPORT_ARTIFACT", message);

function validKey(key) {
  return LEGACY_KEY_PATTERN.test(key) || ARTIFACT_KEY_PATTERN.test(key) || STAGING_KEY_PATTERN.test(key);
}

function assertValidKey(key) {
  if (!validKey(String(key || ""))) throw new AppError(422, "INVALID_REPORT_STORAGE_KEY", "Report artifact metadata is invalid");
}

function storageKey(eventId, jobId, format, claimToken) {
  const extension = String(format).toLowerCase();
  if (!UUID_PATTERN.test(String(eventId)) || !UUID_PATTERN.test(String(jobId)) || !UUID_PATTERN.test(String(claimToken))) {
    throw new AppError(422, "INVALID_REPORT_STORAGE_KEY", "Report artifact identifiers are invalid");
  }
  const key = `claim-${claimToken}.${extension}`;
  if (!ARTIFACT_KEY_PATTERN.test(key)) throw new AppError(422, "INVALID_REPORT_STORAGE_KEY", "Report artifact identifiers are invalid");
  return key;
}

function stagingStorageKey(eventId, jobId, format, claimToken) {
  return `${storageKey(eventId, jobId, format, claimToken)}.stage`;
}

function artifactPath(key) {
  assertValidKey(key);
  return `db://${key}`;
}

async function findBlob(key, db) {
  if (!db.reportArtifactBlob) throw unsafe("Report artifact blob storage is unavailable");
  return db.reportArtifactBlob.findUnique({ where: { storageKey: key } });
}

async function readArtifact(key, { db = prisma } = {}) {
  assertValidKey(key);
  const blob = await findBlob(key, db);
  if (!blob) {
    const error = new Error("Report artifact not found");
    error.code = "ENOENT";
    throw error;
  }
  const contents = Buffer.from(blob.contents);
  const sha256 = crypto.createHash("sha256").update(contents).digest("hex");
  if (blob.sha256 && blob.sha256 !== sha256) throw new AppError(409, "REPORT_HASH_MISMATCH", "Report artifact integrity verification failed");
  return { contents, sha256 };
}

async function writeArtifact(key, contents, { db = prisma, now = new Date() } = {}) {
  if (!STAGING_KEY_PATTERN.test(key)) throw new AppError(422, "INVALID_REPORT_STORAGE_KEY", "Report staging key is invalid");
  if (!db.reportArtifactBlob) throw unsafe("Report artifact blob storage is unavailable");
  const buffer = Buffer.from(contents);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const sizeBytes = BigInt(buffer.length);
  await db.reportArtifactBlob.create({ data: { storageKey: key, contents: buffer, sizeBytes, sha256, createdAt: now } });
  return { storageKey: key, sizeBytes: buffer.length, sha256 };
}

async function publishArtifact(stagingKey, artifactKey, { db = prisma, now = new Date() } = {}) {
  if (!STAGING_KEY_PATTERN.test(stagingKey) || !ARTIFACT_KEY_PATTERN.test(artifactKey)) throw new AppError(422, "INVALID_REPORT_STORAGE_KEY", "Report publication key is invalid");
  if (!db.reportArtifactBlob) throw unsafe("Report artifact blob storage is unavailable");
  const staging = await findBlob(stagingKey, db);
  if (!staging) {
    const error = new Error("Report staging artifact not found");
    error.code = "ENOENT";
    throw error;
  }
  await db.reportArtifactBlob.create({ data: { storageKey: artifactKey, contents: staging.contents, sizeBytes: staging.sizeBytes, sha256: staging.sha256, createdAt: now } });
  await db.reportArtifactBlob.deleteMany({ where: { storageKey: stagingKey } });
  return { storageKey: artifactKey, sizeBytes: Number(staging.sizeBytes), sha256: staging.sha256 };
}

async function deleteArtifact(key, { db = prisma } = {}) {
  assertValidKey(key);
  if (!db.reportArtifactBlob) throw unsafe("Report artifact blob storage is unavailable");
  const deleted = await db.reportArtifactBlob.deleteMany({ where: { storageKey: key } });
  return deleted.count > 0;
}

async function cleanupReportArtifactBlobs({ db = prisma, now = new Date(), staleMs = 60 * 60 * 1000, limit = 100 } = {}) {
  if (!db.reportArtifactBlob) return { inspected: 0, deleted: 0 };
  const staleBefore = new Date(now.getTime() - staleMs);
  const candidates = await db.reportArtifactBlob.findMany({
    where: { storageKey: { endsWith: ".stage" }, createdAt: { lte: staleBefore } },
    select: { storageKey: true },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
  let deleted = 0;
  for (const candidate of candidates) {
    const removed = await db.reportArtifactBlob.deleteMany({ where: { storageKey: candidate.storageKey, createdAt: { lte: staleBefore } } });
    deleted += removed.count;
  }
  return { inspected: candidates.length, deleted };
}

module.exports = { ARTIFACT_KEY_PATTERN, KEY_PATTERN, LEGACY_KEY_PATTERN, STAGING_KEY_PATTERN, artifactPath, cleanupReportArtifactBlobs, deleteArtifact, publishArtifact, readArtifact, stagingStorageKey, storageKey, storageRoot, writeArtifact };
