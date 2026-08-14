const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://vsms_test:vsms_test@127.0.0.1:1/vsms_test";
process.env.NODE_ENV ||= "test";

const backupService = require("../../backend/services/platform/backupService");
const adminSchemas = require("../../backend/schemas/adminSchemas");

test("backup integrity rejects a modified dump", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsms-backup-integrity-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dump = path.join(directory, "vsms-20260812T120000Z-1234abcd.dump");
  fs.writeFileSync(dump, "original encrypted backup bytes");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(dump)).digest("hex");
  fs.writeFileSync(`${dump}.sha256`, `${digest}  ${path.basename(dump)}\n`);

  assert.equal(await backupService.verifyChecksum(dump), true);
  fs.appendFileSync(dump, "tampered");
  assert.equal(await backupService.verifyChecksum(dump), false);
});

test("backup request validation requires the isolated restore acknowledgement", () => {
  assert.equal(adminSchemas.backupParams.parse({
    backupId: "vsms-20260812T120000Z-1234abcd.dump",
  }).backupId, "vsms-20260812T120000Z-1234abcd.dump");
  assert.throws(
    () => adminSchemas.restoreBackupBody.parse({ confirmation: "RESTORE_PRODUCTION" }),
    /Invalid input/,
  );
});

test("the application refuses in-place production restores", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      backupService.restoreBackup("vsms-20260812T120000Z-1234abcd.dump", {
        confirmation: backupService.RESTORE_CONFIRMATION,
      }),
      (error) => error.code === "ISOLATED_RESTORE_REQUIRED",
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
