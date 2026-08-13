const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { attended, attendanceWhere } = require("../../services/event/attendanceDefinition");
const { aggregateRows, resolveBounds, suppressClinicalRows, suppressSensitiveBlock } = require("../../services/reporting/analyticsService");
const { protectSpreadsheetCell, renderCsv } = require("../../services/reporting/reportRenderer");
const { claimNextReportJob, renewReportLease } = require("../../services/reporting/reportExportService");
const { artifactPath, cleanupReportArtifactBlobs, publishArtifact, readArtifact, stagingStorageKey, storageKey, writeArtifact } = require("../../services/reporting/reportArtifactStorage");
const {
  maintainLifecycleEmail,
  processClaimedLifecycleEmail,
  reconcileStaleLifecycleEmails,
  renderTemplate,
  safeMetadata,
  lifecyclePurposeForAccount,
} = require("../../services/account/accountLifecycleNotificationService");

function createArtifactBlobDb() {
  const blobs = new Map();
  const matches = (row, where = {}) => {
    if (where.storageKey && typeof where.storageKey === "string" && row.storageKey !== where.storageKey) return false;
    if (where.storageKey && typeof where.storageKey === "object" && where.storageKey.endsWith && !row.storageKey.endsWith(where.storageKey.endsWith)) return false;
    if (where.createdAt?.lte && row.createdAt > where.createdAt.lte) return false;
    return true;
  };
  return {
    blobs,
    reportArtifactBlob: {
      create: async ({ data }) => {
        if (blobs.has(data.storageKey)) {
          const error = new Error("duplicate storage key");
          error.code = "P2002";
          throw error;
        }
        const row = { ...data, contents: Buffer.from(data.contents), createdAt: data.createdAt || new Date(), updatedAt: data.updatedAt || new Date() };
        blobs.set(row.storageKey, row);
        return row;
      },
      findUnique: async ({ where }) => blobs.get(where.storageKey) || null,
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const [key, row] of [...blobs.entries()]) {
          if (matches(row, where)) { blobs.delete(key); count += 1; }
        }
        return { count };
      },
      findMany: async ({ where, take }) => [...blobs.values()].filter((row) => matches(row, where)).slice(0, take),
    },
  };
}

test("attendance uses either check-in signal and always excludes cancelled registrations", () => {
  assert.equal(attended({ registrationStatus: "SIGNED_UP", checkedIn: true, checkedInAt: null }), true);
  assert.equal(attended({ registrationStatus: "COMPLETED", checkedIn: false, checkedInAt: new Date() }), true);
  assert.equal(attended({ registrationStatus: "CANCELLED", checkedIn: true, checkedInAt: new Date() }), false);
  assert.deepEqual(attendanceWhere("event-id"), {
    eventId: "event-id",
    registrationStatus: { not: "CANCELLED" },
    OR: [{ checkedIn: true }, { checkedInAt: { not: null } }],
  });
});

test("analytics bounds are half-open, event-bounded, and limited to 366 days", () => {
  const event = { startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: new Date("2026-01-03T00:00:00Z") };
  assert.deepEqual(resolveBounds(event, {}), { from: event.startsAt, to: event.endsAt });
  assert.throws(() => resolveBounds(event, { from: "2025-12-31T23:59:59Z", to: "2026-01-02T00:00:00Z" }), (error) => error.code === "ANALYTICS_RANGE_OUTSIDE_EVENT");
  assert.throws(() => resolveBounds(event, { from: "2026-01-02T00:00:00Z", to: "2026-01-02T00:00:00Z" }), (error) => error.code === "INVALID_ANALYTICS_RANGE");
});

test("clinical groups below the threshold are table-safe suppressed values", () => {
  assert.deepEqual(suppressClinicalRows([{ category: "URGENT", count: 4n }, { category: "NORMAL", count: 5n }, { category: "NONE", count: 0n }], 5), [
    { category: "URGENT", count: null, suppressed: true, suppressionReason: "Count is below 5" },
    { category: "NORMAL", count: 5, suppressed: false, suppressionReason: null },
    { category: "NONE", count: 0, suppressed: false, suppressionReason: null },
  ]);
});

test("sensitive dimensions with a small nonzero cell withhold their entire block", () => {
  assert.deepEqual(suppressSensitiveBlock([{ category: "LOW", count: 2n }, { category: "HIGH", count: 20n }], 5), { suppressed: true, rows: [] });
  assert.deepEqual(suppressSensitiveBlock([{ category: "HIGH", count: 5n }, { category: "ZERO", count: 0n }], 5), {
    suppressed: false,
    rows: [
      { category: "HIGH", count: 5, suppressed: false, suppressionReason: null },
      { category: "ZERO", count: 0, suppressed: false, suppressionReason: null },
    ],
  });
});

test("CSV neutralizes formulas after leading whitespace and quotes every field", () => {
  for (const value of ["=1+1", " +cmd", "\t-cmd", "\r@SUM(A1)"]) assert.ok(protectSpreadsheetCell(value).startsWith("'"));
  const csv = renderCsv({ tables: [{ id: "registrations", title: "Registration", columns: [{ key: "metric", label: "Metric" }], rows: [{ metric: '=HYPERLINK("bad")', participantName: "Must not export" }] }] }, "OVERVIEW").toString("utf8");
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.doesNotMatch(csv, /Must not export/);
});

test("report claims use a PostgreSQL skip-locked lease and return one claimed row", async () => {
  const id = crypto.randomUUID();
  let statement;
  const job = { id, claimToken: crypto.randomUUID() };
  const db = {
    $queryRaw: async (sql) => { statement = sql.strings.join(" "); return [{ id }]; },
    reportExportJob: { findUnique: async ({ where }) => { assert.equal(where.id, id); return job; } },
  };
  assert.equal(await claimNextReportJob({ db, now: new Date("2026-01-01T00:00:00Z") }), job);
  assert.match(statement, /FOR UPDATE SKIP LOCKED/);
  assert.match(statement, /lease_expires_at/);
  assert.match(statement, /attempt_count < max_attempts/);
});

test("queue analytics delegates percentiles to the migration-managed PostgreSQL function", async () => {
  const statements = [];
  await aggregateRows({ $queryRaw: async (sql) => { statements.push(sql.strings.join(" ")); return [{}]; } }, crypto.randomUUID(), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));
  assert.match(statements[1], /vsms_event_queue_statistics/);
  assert.match(statements[2], /q\.completed_at >=/);
  assert.match(statements[2], /WHERE s\.event_id/);
  const routines = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20260813040000_add_database_routines/migration.sql"), "utf8");
  assert.match(routines, /percentile_cont\(0\.90\)/);
  assert.match(routines, /registration\."event_id" = p_event_id/);
  const migration = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20260806172000_stage3_hardening/migration.sql"), "utf8");
  assert.match(migration, /stations_event_id_station_id_idx/);
  assert.match(migration, /queue_entries_station_completed_at_idx/);
});

test("report artifact storage is database-backed, not pathname-raceable", async () => {
  const db = createArtifactBlobDb();
  const key = storageKey(crypto.randomUUID(), crypto.randomUUID(), "CSV", crypto.randomUUID());
  const stageKey = stagingStorageKey(crypto.randomUUID(), crypto.randomUUID(), "CSV", key.match(/^claim-([a-f0-9-]+)\.csv$/)[1]);
  const previous = process.env.REPORT_STORAGE_DIR;
  process.env.REPORT_STORAGE_DIR = path.join(__dirname, "../../secure-data", `unsafe-root-${crypto.randomUUID()}`);
  try {
    assert.equal(artifactPath(key), `db://${key}`);
    await writeArtifact(stageKey, Buffer.from("pinned"), { db });
    await publishArtifact(stageKey, key, { db });
    const read = await readArtifact(key, { db });
    assert.equal(read.contents.toString("utf8"), "pinned");
    assert.equal(db.blobs.has(stageKey), false);
  } finally {
    if (previous === undefined) delete process.env.REPORT_STORAGE_DIR; else process.env.REPORT_STORAGE_DIR = previous;
  }
});

test("orphaned staged report blobs are durably tracked and cleaned", async () => {
  const db = createArtifactBlobDb();
  const claimToken = crypto.randomUUID();
  const stageKey = stagingStorageKey(crypto.randomUUID(), crypto.randomUUID(), "CSV", claimToken);
  await writeArtifact(stageKey, Buffer.from("sensitive staged data"), { db, now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(db.blobs.has(stageKey), true);
  const result = await cleanupReportArtifactBlobs({ db, now: new Date("2026-01-01T02:00:00Z"), staleMs: 60 * 60 * 1000 });
  assert.deepEqual(result, { inspected: 1, deleted: 1 });
  assert.equal(db.blobs.has(stageKey), false);
});

test("an expired report owner cannot renew its lease before recovery runs", async () => {
  const now = new Date("2026-01-01T00:01:00.000Z");
  const job = { id: crypto.randomUUID(), claimToken: crypto.randomUUID() };
  let mutation = false;
  await assert.rejects(
    renewReportLease(job, { db: { reportExportJob: { updateMany: async ({ where }) => { mutation = true; assert.equal(where.leaseExpiresAt.gt.getTime(), now.getTime()); return { count: 0 }; } } }, now }),
    (error) => error.code === "REPORT_LEASE_LOST",
  );
  assert.equal(mutation, true);
});

test("manual lifecycle reconciliation rolls its state transition back when the audit insert fails", async () => {
  const deliveryId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const state = { status: "RECONCILIATION_REQUIRED" };
  const db = {
    $transaction: async (callback) => {
      const working = { ...state };
      const tx = {
        lifecycleEmailOutbox: {
          findUnique: async () => ({ id: deliveryId, userId, status: working.status }),
          updateMany: async ({ where, data }) => {
            if (where.status !== working.status) return { count: 0 };
            Object.assign(working, data);
            return { count: 1 };
          },
        },
        auditLog: { create: async () => { throw new Error("audit write failed"); } },
      };
      return callback(tx); // No commit occurs when the callback rejects.
    },
  };
  await assert.rejects(maintainLifecycleEmail(deliveryId, "REQUEUE", "Provider logs verified", actorId, {}, db));
  assert.equal(state.status, "RECONCILIATION_REQUIRED");
});

test("stale lifecycle reconciliation rolls back when the audit insert fails", async () => {
  const deliveryId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const claimToken = crypto.randomUUID();
  const state = { status: "SENDING", claimToken, leaseExpiresAt: new Date("2026-01-01T00:00:00Z") };
  const db = {
    lifecycleEmailOutbox: {
      findMany: async () => [{ id: deliveryId, userId, claimToken }],
    },
    $transaction: async (callback) => {
      const working = { ...state };
      const tx = {
        lifecycleEmailOutbox: {
          updateMany: async ({ where, data }) => {
            assert.equal(where.id, deliveryId);
            assert.equal(where.claimToken, claimToken);
            if (working.status !== where.status) return { count: 0 };
            Object.assign(working, data);
            return { count: 1 };
          },
        },
        auditLog: { create: async () => { throw new Error("audit write failed"); } },
      };
      return callback(tx);
    },
  };
  await assert.rejects(reconcileStaleLifecycleEmails({ db, now: new Date("2026-01-01T00:01:00Z") }));
  assert.equal(state.status, "SENDING");
});

test("lifecycle templates escape interpolation and reject arbitrary or sensitive metadata", () => {
  assert.throws(() => safeMetadata("APPROVED", { body: "secret" }), /unsafe field/);
  assert.throws(() => safeMetadata("PASSWORD_CHANGED", { resetToken: "secret" }), /unsafe field/);
  const template = renderTemplate("EVENT_ASSIGNMENT", { fullName: "<Admin>" }, safeMetadata("EVENT_ASSIGNMENT", { eventId: crypto.randomUUID(), eventName: "<Event>", roles: ["SUPPORT"] }));
  assert.match(template.html, /&lt;Admin&gt;/);
  assert.match(template.html, /&lt;Event&gt;/);
  assert.doesNotMatch(template.html, /<Admin>|<Event>/);
});

test("lifecycle resend purpose covers every account state, including pending and disabled accounts", () => {
  const base = { approvalState: "APPROVED", accessState: "ENABLED", deprovisionedAt: null };
  assert.equal(lifecyclePurposeForAccount({ ...base, approvalState: "PENDING" }), "SIGNUP_RECEIVED");
  assert.equal(lifecyclePurposeForAccount({ ...base, approvalState: "APPROVED" }), "APPROVED");
  assert.equal(lifecyclePurposeForAccount({ ...base, approvalState: "REJECTED" }), "REJECTED");
  assert.equal(lifecyclePurposeForAccount({ ...base, accessState: "SUSPENDED" }), "SUSPENDED");
  assert.equal(lifecyclePurposeForAccount({ ...base, accessState: "DISABLED" }), "DEPROVISIONED");
  assert.equal(lifecyclePurposeForAccount({ ...base, deprovisionedAt: new Date() }), "DEPROVISIONED");
  assert.match(renderTemplate("DEPROVISIONED", { fullName: "Staff" }).text, /disabled/);
});

test("Google SMTP acceptance maps to SENT, never DELIVERED", async () => {
  const updates = [];
  const delivery = { id: crypto.randomUUID(), purpose: "APPROVED", metadata: {}, claimToken: crypto.randomUUID(), attemptCount: 1, maxAttempts: 5, user: { email: "staff@example.test", fullName: "Staff" } };
  const result = await processClaimedLifecycleEmail(delivery, {
    db: { lifecycleEmailOutbox: { updateMany: async (input) => { updates.push(input); return { count: 1 }; } } },
    now: new Date("2026-01-01T00:00:00Z"),
    transport: { sendMail: async () => ({ accepted: [delivery.user.email], messageId: "google-id" }) },
  });
  assert.equal(result.status, "SENT");
  assert.equal(updates[0].data.status, "SENT");
  assert.notEqual(updates[0].data.status, "DELIVERED");
});

test("SMTP timeout requires manual reconciliation and is never automatically retried", async () => {
  let update;
  const delivery = { id: crypto.randomUUID(), purpose: "APPROVED", metadata: {}, claimToken: crypto.randomUUID(), attemptCount: 1, maxAttempts: 5, user: { email: "staff@example.test", fullName: "Staff" } };
  const result = await processClaimedLifecycleEmail(delivery, {
    db: { lifecycleEmailOutbox: { updateMany: async (input) => { update = input; return { count: 1 }; } } },
    now: new Date("2026-01-01T00:00:00Z"),
    transport: { sendMail: async () => { const error = new Error("provider response may be ambiguous"); error.code = "ETIMEDOUT"; throw error; } },
  });
  assert.deepEqual(result, { status: "RECONCILIATION_REQUIRED", accepted: false, retryable: false, failureCode: "SMTP_TIMEOUT_OR_CONNECTION" });
  assert.equal(update.data.status, "RECONCILIATION_REQUIRED");
  assert.equal(update.data.providerMessageId, undefined);
});
