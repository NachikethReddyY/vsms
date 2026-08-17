const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const AppError = require("../../errors/AppError");
const { syncOperationsBody } = require("../../schemas/screeningSchemas");
const { processSyncOperations } = require("../../services/screening/syncService");

const eventId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const user = { userId: crypto.randomUUID(), professionalCategory: "DOCTOR" };

const decision = {
  outcome: "REFER",
  contextVersion: "a".repeat(64),
  confirmed: true,
  clinicalSummary: "Refer for a complete ophthalmology assessment.",
  recommendations: "Arrange follow-up within two weeks.",
  urgency: "PRIORITY",
  referral: {
    destinationName: "Community eye clinic",
    reason: "Reduced visual acuity requires specialist assessment.",
  },
  signatureObjectKey: `signatures/${user.userId}/review-decision-${eventId}-${crypto.randomUUID()}.png`,
  signatureSha256: "b".repeat(64),
  signatureMimeType: "image/png",
};

const reviewAction = (overrides = {}) => ({
  type: "REVIEW_DECISION",
  clientActionId: crypto.randomUUID(),
  registrationId,
  decision,
  ...overrides,
});

const createDb = () => {
  const rows = [];
  const transitions = [];
  let transactionDepth = 0;
  const db = {
    rows,
    transitions,
    get inTransaction() { return transactionDepth > 0; },
    $transaction: async (callback) => {
      transactionDepth += 1;
      try {
        return await callback(db);
      } finally {
        transactionDepth -= 1;
      }
    },
    syncAction: {
      findFirst: async ({ where }) => structuredClone(rows.find((row) => (
        row.userId === where.userId && row.clientActionId === where.clientActionId
      )) || null),
      findUnique: async ({ where }) => structuredClone(rows.find((row) => row.id === where.id) || null),
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), errorCode: null, responseSnapshot: null, ...structuredClone(data) };
        rows.push(row);
        return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const row = rows.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
        if (!row) return { count: 0 };
        if (data.status === "APPLIED") assert.equal(db.inTransaction, true, "domain write and APPLIED ledger transition must share a transaction");
        for (const [key, value] of Object.entries(data)) {
          row[key] = value && typeof value === "object" && "increment" in value
            ? row[key] + value.increment
            : structuredClone(value);
        }
        return { count: 1 };
      },
    },
    syncActionTransition: {
      create: async ({ data }) => {
        transitions.push(structuredClone(data));
        return data;
      },
    },
  };
  return db;
};

const invoke = (db, action, review, queue = {}) => processSyncOperations(
  eventId,
  { clientBatchId: crypto.randomUUID(), actions: [action] },
  user,
  { ipAddress: "127.0.0.1" },
  { db, review, queue, audit: async () => {} },
);

test("review decision applies once with a deterministic id and a redacted durable receipt", async () => {
  const db = createDb();
  const action = reviewAction();
  const referralId = crypto.randomUUID();
  let applies = 0;
  let authorizations = 0;
  let verifications = 0;
  const review = {
    authorizeReviewSyncAction: async () => { authorizations += 1; },
    verifyReviewDecisionSignature: async () => { verifications += 1; },
    recordDecision: async (_eventId, _registrationId, receivedDecision, _user, _ip, options) => {
      applies += 1;
      assert.equal(db.inTransaction, true);
      assert.equal(options.db, db);
      assert.equal(options.reviewId, action.clientActionId);
      assert.equal(options.signatureVerified, true);
      assert.equal(receivedDecision, decision);
      return {
        registrationStatus: "COMPLETED",
        review: {
          reviewId: options.reviewId,
          signedAt: new Date("2030-01-01T10:00:00.000Z"),
          clinicalSummary: decision.clinicalSummary,
          signatureSha256: decision.signatureSha256,
        },
        referral: {
          referralId,
          status: "DRAFT",
          reason: decision.referral.reason,
          delivery: { recipient: "private@example.test" },
        },
      };
    },
  };

  const first = await invoke(db, action, review);
  const replay = await invoke(db, action, review);

  assert.equal(applies, 1);
  assert.equal(authorizations, 2, "current reviewer duty must be rechecked on replay");
  assert.equal(verifications, 1);
  assert.deepEqual(first.actions[0], replay.actions[0]);
  assert.deepEqual(first.actions[0].result, {
    reviewId: action.clientActionId,
    registrationStatus: "COMPLETED",
    referralId,
    referralStatus: "DRAFT",
    signedAt: "2030-01-01T10:00:00.000Z",
  });
  assert.deepEqual(db.rows[0].payload, { schemaVersion: 1, actionType: "REVIEW_DECISION" });
  assert.equal(db.rows[0].entityId, action.clientActionId);
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "APPLIED"]);

  const durable = JSON.stringify({ rows: db.rows, transitions: db.transitions });
  for (const forbidden of [
    decision.clinicalSummary,
    decision.recommendations,
    decision.referral.reason,
    decision.signatureObjectKey,
    decision.signatureSha256,
    "private@example.test",
  ]) {
    assert.equal(durable.includes(forbidden), false, `${forbidden} must not enter the sync ledger`);
  }
});

test("review authorization for the whole mixed batch runs before any ledger write", async () => {
  const db = createDb();
  const action = reviewAction();
  const queueAction = {
    type: "QUEUE_CALL",
    clientActionId: crypto.randomUUID(),
    queueId: crypto.randomUUID(),
    expectedStatus: "WAITING",
  };
  const review = {
    authorizeReviewSyncAction: async () => {},
    verifyReviewDecisionSignature: async () => assert.fail("must not verify"),
    recordDecision: async () => assert.fail("must not apply"),
  };
  const queue = {
    authorizeQueueSyncAction: async () => {
      throw new AppError(403, "CURRENT_DUTY_REQUIRED", "Duty expired");
    },
  };

  await assert.rejects(processSyncOperations(
    eventId,
    { clientBatchId: crypto.randomUUID(), actions: [action, queueAction] },
    user,
    null,
    { db, review, queue, audit: async () => {} },
  ), (error) => error.code === "CURRENT_DUTY_REQUIRED");
  assert.equal(db.rows.length, 0);
});

test("review action schema reuses the strict clinical decision contract", () => {
  const batch = (action) => ({ clientBatchId: crypto.randomUUID(), actions: [action] });
  const valid = reviewAction();
  assert.equal(syncOperationsBody.safeParse(batch(valid)).success, true);
  for (const invalid of [
    { ...valid, decision: { ...decision, confirmed: false } },
    { ...valid, decision: { ...decision, extra: "not allowed" } },
    { ...valid, registrationId: "not-a-uuid" },
    { ...valid, extra: "not allowed" },
  ]) {
    assert.equal(syncOperationsBody.safeParse(batch(invalid)).success, false);
  }
});
