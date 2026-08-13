const crypto = require("crypto");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const AppError = require("../../errors/AppError");
const { createAuditLog } = require("../../utils/logging/audit");

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");
const BACKUP_PATTERN = /^vsms-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/;
const RESTORE_CONFIRMATION = "RESTORE_ISOLATED_TEST_DATABASE";

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const backupDirectory = () => {
  const configured = process.env.VSMS_BACKUP_DIR;
  if (!configured || !path.isAbsolute(configured)) {
    throw new AppError(503, "BACKUP_STORAGE_NOT_CONFIGURED", "Secure external backup storage is not configured");
  }
  const resolved = path.resolve(configured);
  if (isInside(REPOSITORY_ROOT, resolved)) {
    throw new AppError(503, "UNSAFE_BACKUP_STORAGE", "Backup storage must be outside the source repository");
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  return resolved;
};

const databaseUrl = () => {
  if (!process.env.DATABASE_URL) {
    throw new AppError(503, "DATABASE_NOT_CONFIGURED", "Database backup connection is not configured");
  }
  return process.env.DATABASE_URL;
};

const sanitizeBackupId = (backupId) => {
  if (typeof backupId !== "string" || path.basename(backupId) !== backupId || !BACKUP_PATTERN.test(backupId)) {
    throw new AppError(422, "INVALID_BACKUP_ID", "Invalid backup identifier");
  }
  return backupId;
};

const digestFile = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  stream.on("error", reject);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolve(hash.digest("hex")));
});

const checksumPath = (filePath) => `${filePath}.sha256`;

const writeChecksum = async (filePath) => {
  const digest = await digestFile(filePath);
  fs.writeFileSync(checksumPath(filePath), `${digest}  ${path.basename(filePath)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return digest;
};

const verifyChecksum = async (filePath) => {
  const sidecar = checksumPath(filePath);
  if (!fs.existsSync(sidecar)) return false;
  const match = fs.readFileSync(sidecar, "utf8").trim().match(/^([a-f0-9]{64})  ([^/\\]+)$/);
  if (!match || match[2] !== path.basename(filePath)) return false;
  const actual = await digestFile(filePath);
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(match[1], "hex"));
};

const removeArtifacts = (filePath) => {
  for (const candidate of [filePath, checksumPath(filePath)]) {
    try {
      fs.rmSync(candidate, { force: true });
    } catch {
      // The primary operation reports its own failure; cleanup remains best effort.
    }
  }
};

const runDatabaseTool = async (binary, args) => {
  try {
    await execFileAsync(binary, args, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15 * 60_000,
      windowsHide: true,
    });
  } catch (error) {
    throw new AppError(503, "DATABASE_TOOL_FAILED", `${binary} could not complete safely`, {
      tool: binary,
      exitCode: error.code ?? null,
    });
  }
};

const audit = ({ actorId, action, backupId, description, context }) => createAuditLog({
  userId: actorId,
  action,
  entityName: "DatabaseBackup",
  entityId: crypto.randomUUID(),
  newValue: {
    backupId,
    ...(description ? { description } : {}),
  },
  context,
});

exports.listBackups = async () => {
  const directory = backupDirectory();
  const files = fs.readdirSync(directory).filter((file) => BACKUP_PATTERN.test(file));
  return Promise.all(files.map(async (backupId) => {
    const filePath = path.join(directory, backupId);
    const stats = fs.statSync(filePath);
    return {
      backupId,
      sizeBytes: stats.size,
      createdAt: stats.birthtime.toISOString(),
      integrity: await verifyChecksum(filePath) ? "VERIFIED" : "FAILED",
    };
  }));
};

exports.createBackup = async ({ description }, actorId, context) => {
  const directory = backupDirectory();
  const timestamp = new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const backupId = `vsms-${timestamp}-${crypto.randomBytes(4).toString("hex")}.dump`;
  const filePath = path.join(directory, backupId);

  try {
    await runDatabaseTool("pg_dump", [
      `--dbname=${databaseUrl()}`,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${filePath}`,
    ]);
    await writeChecksum(filePath);
    await audit({ actorId, action: "SYSTEM_BACKUP_CREATED", backupId, description, context });
  } catch (error) {
    removeArtifacts(filePath);
    throw error;
  }

  return { message: "Backup created and integrity-protected.", backupId };
};

exports.getBackupFilePath = async (backupId) => {
  const filePath = path.join(backupDirectory(), sanitizeBackupId(backupId));
  if (!fs.existsSync(filePath)) throw new AppError(404, "BACKUP_NOT_FOUND", "Backup was not found");
  if (!await verifyChecksum(filePath)) {
    throw new AppError(409, "BACKUP_INTEGRITY_FAILED", "Backup integrity verification failed");
  }
  return filePath;
};

exports.restoreBackup = async (backupId, { confirmation }, actorId, context) => {
  if (process.env.NODE_ENV === "production") {
    throw new AppError(409, "ISOLATED_RESTORE_REQUIRED", "Production recovery must restore to an isolated database or use managed point-in-time recovery");
  }
  if (confirmation !== RESTORE_CONFIRMATION) {
    throw new AppError(422, "RESTORE_CONFIRMATION_REQUIRED", `Confirmation must equal ${RESTORE_CONFIRMATION}`);
  }
  const url = new URL(databaseUrl());
  if (!url.pathname.slice(1).endsWith("_test")) {
    throw new AppError(409, "TEST_DATABASE_REQUIRED", "Direct restore is restricted to an isolated database ending in _test");
  }

  const filePath = await exports.getBackupFilePath(backupId);
  await runDatabaseTool("pg_restore", [
    `--dbname=${url.toString()}`,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "--single-transaction",
    filePath,
  ]);
  await audit({ actorId, action: "SYSTEM_BACKUP_RESTORED", backupId, context });
  return { message: "Backup restored into the isolated test database." };
};

exports.deleteBackup = async (backupId, actorId, context) => {
  const filePath = path.join(backupDirectory(), sanitizeBackupId(backupId));
  if (!fs.existsSync(filePath)) throw new AppError(404, "BACKUP_NOT_FOUND", "Backup was not found");
  removeArtifacts(filePath);
  await audit({ actorId, action: "SYSTEM_BACKUP_DELETED", backupId, context });
  return { message: "Backup and checksum deleted." };
};

exports.RESTORE_CONFIRMATION = RESTORE_CONFIRMATION;
exports.verifyChecksum = verifyChecksum;
