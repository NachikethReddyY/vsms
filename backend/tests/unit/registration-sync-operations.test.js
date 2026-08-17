const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const AppError = require("../../errors/AppError");
const { syncOperationsBody } = require("../../schemas/screeningSchemas");
const { eventRegistrationBody } = require("../../schemas/registrationSchemas");
const registrationService = require("../../services/participant/registrationService");
const { processSyncOperations } = require("../../services/screening/syncService");

const eventId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const user = { userId: crypto.randomUUID(), roles: ["REGISTRATION"] };

const operation = (overrides = {}) => ({
  type: "REGISTRATION_CREATE",
  clientActionId: crypto.randomUUID(),
  clientParticipantId: crypto.randomUUID(),
  clientRegistrationId: crypto.randomUUID(),
  participant: {
    firstName: "Ada",
    lastName: "Lovelace",
    dateOfBirth: "1980-01-01",
    gender: "F",
    contactNumber: "+6591234567",
    nric: "S1234567D",
    email: "ada@example.test",
    race: "Other",
    nationality: "Singaporean",
    addressStreet: "1 Test Street",
    addressUnit: "#01-01",
    addressPostalCode: "123456",
    preferredLanguage: "English",
    accessibilityNotes: "",
  },
  emergencyContact: {
    contactName: "Grace Hopper",
    relationship: "Friend",
    phoneNumber: "+6597654321",
  },
  evidence: { workflowStartedAt: null, paperFormUsed: false },
  proposed: { queueNumber: 17, nextStationId: stationId, nextStationNumber: 1 },
  ...overrides,
});

const createDb = () => {
  const rows = [];
  const transitions = [];
  const db = {
    rows,
    transitions,
    $transaction: async (callback) => callback(db),
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
        for (const [key, value] of Object.entries(data)) {
          row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : structuredClone(value);
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

const invoke = (db, action, registration, authorize = async () => {}) => processSyncOperations(
  eventId,
  { clientBatchId: crypto.randomUUID(), actions: [action] },
  user,
  { requestId: crypto.randomUUID() },
  { db, registration, authorize, audit: async () => {} },
);

test("registration operation applies once, replays its canonical receipt, and redacts its ledger", async () => {
  const db = createDb();
  const action = operation();
  let applies = 0;
  const canonicalRegistrationId = crypto.randomUUID();
  const registration = {
    createOfflineWalkInRegistration: async () => {
      applies += 1;
      return {
        participantId: action.clientParticipantId,
        registrationId: canonicalRegistrationId,
        queueNumber: 22,
        nextStation: { stationId, stationName: "Visual Acuity", stationNumber: 1, secret: action.participant.nric },
        canonicalQrAvailable: true,
        qrToken: "must-not-persist",
        participant: action.participant,
      };
    },
  };

  const first = await invoke(db, action, registration);
  const replay = await invoke(db, action, registration);

  assert.equal(applies, 1);
  assert.deepEqual(first.actions[0], replay.actions[0]);
  assert.deepEqual(first.actions[0].result, {
    participantId: action.clientParticipantId,
    registrationId: canonicalRegistrationId,
    queueNumber: 22,
    nextStation: { stationId, stationName: "Visual Acuity", stationNumber: 1 },
    canonicalQrAvailable: true,
  });
  assert.deepEqual(db.rows[0].payload, { schemaVersion: 1, actionType: "REGISTRATION_CREATE" });
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "APPLIED"]);
  const durable = JSON.stringify({ rows: db.rows, transitions: db.transitions });
  for (const forbidden of ["S1234567D", "+6591234567", "Grace Hopper", "must-not-persist", "dateOfBirth"]) {
    assert.equal(durable.includes(forbidden), false, `${forbidden} must not enter the sync ledger`);
  }
});

test("client action reuse with changed participant data conflicts without applying again", async () => {
  const db = createDb();
  const action = operation();
  let applies = 0;
  const registration = { createOfflineWalkInRegistration: async () => { applies += 1; return {
    participantId: action.clientParticipantId,
    registrationId: crypto.randomUUID(),
    queueNumber: 1,
    nextStation: null,
    canonicalQrAvailable: false,
  }; } };

  await invoke(db, action, registration);
  const changed = { ...action, participant: { ...action.participant, firstName: "Changed" } };
  const response = await invoke(db, changed, registration);

  assert.equal(applies, 1);
  assert.equal(response.actions[0].status, "CONFLICT");
  assert.equal(response.actions[0].errorCode, "SYNC_IDEMPOTENCY_REUSED");
});

test("REGISTRATION authorization is checked before recording operations", async () => {
  const db = createDb();
  await assert.rejects(
    invoke(db, operation(), { createOfflineWalkInRegistration: async () => assert.fail("must not apply") }, async () => {
      throw new AppError(403, "FORBIDDEN", "No registration duty");
    }),
    (error) => error.status === 403 && error.code === "FORBIDDEN",
  );
  assert.equal(db.rows.length, 0);
});

test("operation schema rejects unknown, malformed, and inconsistent registration fields", () => {
  const valid = operation();
  assert.equal(syncOperationsBody.safeParse({ clientBatchId: crypto.randomUUID(), actions: [valid] }).success, true);
  for (const action of [
    { ...valid, participant: { ...valid.participant, nric: "invalid" } },
    { ...valid, emergencyContact: { ...valid.emergencyContact, extra: "not allowed" } },
    { ...valid, evidence: { workflowStartedAt: null, paperFormUsed: true } },
    { ...valid, proposed: { ...valid.proposed, queueNumber: 0 } },
  ]) {
    assert.equal(syncOperationsBody.safeParse({ clientBatchId: crypto.randomUUID(), actions: [action] }).success, false);
  }
});

test("online registration evidence is typed and bounded by the canonical validator", () => {
  const workflowStartedAt = new Date().toISOString();
  assert.equal(eventRegistrationBody.safeParse({
    participantId: crypto.randomUUID(),
    workflowStartedAt,
    paperFormUsed: true,
    paperExceptionReason: "Participant requested paper",
  }).success, true);
  assert.deepEqual(registrationService.validateRegistrationEvidence({ workflowStartedAt, paperFormUsed: false }), {
    workflowStartedAt: new Date(workflowStartedAt),
    paperFormUsed: false,
    paperExceptionReason: null,
  });
  assert.throws(
    () => registrationService.validateRegistrationEvidence({
      workflowStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      paperFormUsed: false,
    }),
    /24-hour workflow window/,
  );
});
