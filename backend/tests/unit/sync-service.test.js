const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const AppError = require("../../errors/AppError");
const { screeningSyncBody } = require("../../schemas/screeningSchemas");
const { processScreeningSync, requestFingerprint } = require("../../services/screening/syncService");

const eventId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const user = { userId: crypto.randomUUID(), systemRole: "STAFF", roles: ["SCREENER"] };
const context = { requestId: crypto.randomUUID(), deviceId: null, deviceName: "test", ipAddress: "127.0.0.1" };

const action = (overrides = {}) => ({
  clientActionId: crypto.randomUUID(),
  stationId,
  stationType: "VISUAL_ACUITY",
  payload: {
    registrationId,
    idempotencyKey: crypto.randomUUID(),
    acknowledged: false,
    resultData: {
      chartDistanceMetres: "6",
      od: { kind: "FRACTION", denominator: 6 },
      os: { kind: "FRACTION", denominator: 6 },
      withUsualDistanceGlasses: "unknown",
    },
  },
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
      findFirst: async ({ where }) => {
        const row = rows.find((candidate) => (
          candidate.userId === where.userId && candidate.clientActionId === where.clientActionId
        ));
        return row ? structuredClone(row) : null;
      },
      findUnique: async ({ where }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        return row ? structuredClone(row) : null;
      },
      create: async ({ data }) => {
        if (rows.some((row) => row.userId === data.userId && row.clientActionId === data.clientActionId)) {
          throw Object.assign(new Error("duplicate client action"), { code: "P2002" });
        }
        const row = { id: crypto.randomUUID(), retryCount: 0, version: 0, errorCode: null, responseSnapshot: null, ...structuredClone(data) };
        rows.push(row);
        return structuredClone(row);
      },
      update: async ({ where, data }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        Object.assign(row, structuredClone(data));
        return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const row = rows.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
        if (!row) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in value) row[key] += value.increment;
          else row[key] = structuredClone(value);
        }
        return { count: 1 };
      },
    },
    syncActionTransition: {
      create: async ({ data }) => {
        transitions.push({ id: crypto.randomUUID(), ...structuredClone(data) });
        return transitions.at(-1);
      },
    },
  };
  return db;
};

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
};

const createScreening = ({ save } = {}) => ({
  listStations: async () => ({
    event: { eventId, name: "Live event", status: "IN_PROGRESS", venue: "Secret venue details" },
    stations: [{
      stationId,
      stationName: "Visual Acuity",
      stationType: "VISUAL_ACUITY",
      stationOrder: 1,
      isActive: true,
      offlineAccessExpiresAt: "2026-08-05T09:00:00.000Z",
      internalField: "not synced",
    }],
  }),
  listQueue: async () => ({
    station: { stationId },
    registrations: [{
      registrationId,
      participantDisplayName: "Daniel Tan",
      queueNumber: 1,
      status: "CHECKED_IN",
      passToken: "must-not-sync",
      nric: "S1234567A",
      participant: { dateOfBirth: "1975-09-23" },
      existingResult: { resultId: crypto.randomUUID(), overallFlag: "NORMAL", isFlagged: false, createdAt: new Date() },
    }],
  }),
  saveDynamic: save || (async () => ({
    created: true,
    result: {
      resultId: crypto.randomUUID(),
      overallFlag: "NORMAL",
      isFlagged: false,
      evaluation: { ruleVersion: "TEMPLATE-SCHEMA-1.0", reasons: [] },
      resultData: { clinical: "not persisted in sync ledger" },
    },
  })),
  saveVisualAcuity: save || (async () => ({
    created: true,
    result: {
      resultId: crypto.randomUUID(),
      overallFlag: "NORMAL",
      isFlagged: false,
      evaluation: { ruleVersion: "VSMS-VA-1.0", reasons: [] },
      resultData: { clinical: "not persisted in sync ledger" },
    },
  })),
  saveEyeHealth: save || (async () => ({
    created: true,
    result: {
      resultId: crypto.randomUUID(),
      overallFlag: "NORMAL",
      isFlagged: false,
      evaluation: { ruleVersion: "VSMS-EH-1.0", reasons: [] },
      resultData: { clinical: "not persisted in sync ledger" },
    },
  })),
});

const invoke = (body, {
  db = createDb(),
  screening = createScreening(),
  audits = [],
  processingLeaseMs,
  waitTimeoutMs,
} = {}) => ({
  db,
  audits,
  promise: processScreeningSync(eventId, body, user, context, {
    db,
    screening,
    audit: async (entry) => { audits.push(entry); },
    processingLeaseMs,
    waitTimeoutMs,
  }),
});

const seedProcessingAction = (db, currentAction, processingStartedAt) => {
  const row = {
    id: crypto.randomUUID(),
    userId: user.userId,
    eventId,
    stationId: currentAction.stationId,
    clientActionId: currentAction.clientActionId,
    requestFingerprint: requestFingerprint({ eventId, userId: user.userId, action: currentAction }),
    operation: "UPDATE",
    entityType: "ScreeningResult",
    entityId: currentAction.payload.registrationId,
    payload: { schemaVersion: 1, stationType: currentAction.stationType },
    status: "PROCESSING",
    retryCount: 0,
    version: 1,
    processingStartedAt,
    errorCode: null,
    responseSnapshot: null,
  };
  db.rows.push(row);
  db.transitions.push(
    { id: crypto.randomUUID(), syncActionId: row.id, sequence: 0, status: "PENDING", retryCount: 0 },
    { id: crypto.randomUUID(), syncActionId: row.id, sequence: 1, status: "PROCESSING", retryCount: 0 },
  );
  return row;
};

test("sync applies an authorized action and stores only safe immutable ledger evidence", async () => {
  const db = createDb();
  const currentAction = action();
  const run = invoke({ clientBatchId: crypto.randomUUID(), actions: [currentAction] }, { db });
  const response = await run.promise;

  assert.equal(response.actions[0].status, "APPLIED");
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "APPLIED"]);
  assert.deepEqual(db.rows[0].payload, { schemaVersion: 1, stationType: "VISUAL_ACUITY" });
  assert.equal(db.rows[0].entityId, registrationId);
  assert.equal(db.rows[0].responseSnapshot.resultData, undefined);
  assert.equal(response.pull.stations[0].registrations[0].passToken, undefined);
  assert.equal(response.pull.stations[0].registrations[0].nric, undefined);
  assert.equal(response.pull.stations[0].registrations[0].participant, undefined);
  assert.equal(response.pull.event.venue, undefined);
  assert.equal(run.audits[0].action, "SCREENING_SYNC_ACTION_APPLIED");
  assert.equal(run.audits[0].entityId, currentAction.clientActionId);
  assert.equal(run.audits[0].outcome, "SUCCESS");
  assert.equal(run.audits[1].action, "SCREENING_SYNC_BATCH");
  assert.equal(run.audits[1].newValue.actionCount, 1);

  const durable = JSON.stringify({ rows: db.rows, transitions: db.transitions, audits: run.audits });
  for (const forbidden of ["must-not-sync", "S1234567A", "dateOfBirth", "resultData"]) {
    assert.equal(durable.includes(forbidden), false, `${forbidden} must not enter durable sync evidence`);
  }
});

test("APPLIED receipts persist and replay only allowlisted route progression fields", async () => {
  const db = createDb();
  const nextStationId = crypto.randomUUID();
  const currentAction = action();
  let saves = 0;
  const screening = createScreening({ save: async () => {
    saves += 1;
    return {
      result: {
        resultId: crypto.randomUUID(),
        overallFlag: "NORMAL",
        isFlagged: false,
        resultData: { clinical: "must not persist" },
        evaluation: { ruleVersion: "VSMS-VA-1.0" },
      },
      routeProgression: {
        status: "ADDED_TO_QUEUE",
        routeVersion: 2,
        completedStation: { stationId, stationName: "Visual Acuity", stationType: "VISUAL_ACUITY", routeStepId: crypto.randomUUID() },
        nextStation: { stationId: nextStationId, stationName: "Refraction", stationType: "REFRACTION", internalCapacity: 4 },
        nextQueue: { stationId: nextStationId, stationName: "Refraction", stationType: "REFRACTION", queueNumber: 8, status: "WAITING", actorUserId: user.userId },
        audit: { actorUserId: user.userId },
      },
    };
  } });
  const body = { clientBatchId: crypto.randomUUID(), actions: [currentAction] };

  const first = await invoke(body, { db, screening }).promise;
  const replay = await invoke({ ...body, clientBatchId: crypto.randomUUID() }, { db, screening }).promise;

  assert.equal(saves, 1);
  assert.deepEqual(first.actions[0].result, replay.actions[0].result);
  assert.deepEqual(first.actions[0].result.routeProgression, {
    status: "ADDED_TO_QUEUE",
    routeVersion: 2,
    completedStation: { stationId, stationName: "Visual Acuity", stationType: "VISUAL_ACUITY" },
    nextStation: { stationId: nextStationId, stationName: "Refraction", stationType: "REFRACTION" },
    nextQueue: { stationId: nextStationId, stationName: "Refraction", stationType: "REFRACTION", queueNumber: 8, status: "WAITING" },
  });
  const durable = JSON.stringify(db.rows[0].responseSnapshot);
  for (const forbidden of ["clinical", "routeStepId", "internalCapacity", "actorUserId", "audit"]) {
    assert.equal(durable.includes(forbidden), false, `${forbidden} must not enter the durable sync receipt`);
  }
});

test("route and version conflicts stay allowlisted conflicts without a progression receipt", async () => {
  for (const code of ["ROUTE_STATION_MISMATCH", "ROUTE_PROGRESSION_CONFLICT", "ROUTE_NOT_ASSIGNED", "ROUTE_QUEUE_CONFLICT"]) {
    const db = createDb();
    const screening = createScreening({ save: async () => {
      throw new AppError(409, code, "Internal route conflict details");
    } });
    const run = invoke(
      { clientBatchId: crypto.randomUUID(), actions: [action()] },
      { db, screening },
    );
    const response = await run.promise;

    assert.deepEqual(response.actions[0], {
      clientActionId: response.actions[0].clientActionId,
      status: "CONFLICT",
      retryCount: 0,
      errorCode: code,
    });
    assert.equal(db.rows[0].responseSnapshot, null);
    assert.equal(run.audits[0].action, "SCREENING_SYNC_ACTION_CONFLICT");
    assert.equal(run.audits[0].outcome, "DENIED");
    assert.equal(run.audits[0].newValue.errorCode, code);
  }
});

test("exact client-action replay is idempotent and mismatched reuse is a conflict", async () => {
  const db = createDb();
  let saves = 0;
  const screening = createScreening({ save: async () => {
    saves += 1;
    return { result: { resultId: crypto.randomUUID(), overallFlag: "NORMAL", isFlagged: false, ruleVersion: "v1" } };
  } });
  const original = action();

  const first = invoke({ clientBatchId: crypto.randomUUID(), actions: [original] }, { db, screening });
  await first.promise;
  const replay = invoke({ clientBatchId: crypto.randomUUID(), actions: [original] }, { db, screening });
  assert.equal((await replay.promise).actions[0].status, "APPLIED");
  assert.equal(saves, 1);
  assert.deepEqual(db.transitions.map(({ status }) => status), ["PENDING", "PROCESSING", "APPLIED"]);

  const changed = action({
    clientActionId: original.clientActionId,
    payload: { ...original.payload, acknowledged: true },
  });
  const collision = invoke({ clientBatchId: crypto.randomUUID(), actions: [changed] }, { db, screening });
  const collisionResponse = await collision.promise;
  assert.equal(collisionResponse.actions[0].status, "CONFLICT");
  assert.equal(collisionResponse.actions[0].errorCode, "SYNC_IDEMPOTENCY_REUSED");
  assert.equal(saves, 1);
});

test("failed actions retain a safe code and retry through a claimed PROCESSING attempt", async () => {
  const db = createDb();
  let attempts = 0;
  const screening = createScreening({ save: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("database password and participant details must not leak");
    return { result: { resultId: crypto.randomUUID(), overallFlag: "NORMAL", isFlagged: false, ruleVersion: "v1" } };
  } });
  const retryable = action();

  const first = invoke({ clientBatchId: crypto.randomUUID(), actions: [retryable] }, { db, screening });
  const firstResponse = await first.promise;
  assert.equal(firstResponse.actions[0].status, "FAILED");
  assert.equal(firstResponse.actions[0].errorCode, "SYNC_APPLY_FAILED");
  assert.equal(first.audits[0].action, "SCREENING_SYNC_ACTION_FAILED");
  assert.equal(first.audits[0].outcome, "FAILED");
  assert.equal(first.audits[0].newValue.errorCode, "SYNC_APPLY_FAILED");
  assert.equal(JSON.stringify(db.rows).includes("database password"), false);

  const second = invoke({ clientBatchId: crypto.randomUUID(), actions: [retryable] }, { db, screening });
  const secondResponse = await second.promise;
  assert.equal(secondResponse.actions[0].status, "APPLIED");
  assert.equal(secondResponse.actions[0].retryCount, 1);
  assert.deepEqual(db.transitions.map(({ status, retryCount }) => [status, retryCount]), [
    ["PENDING", 0],
    ["PROCESSING", 0],
    ["FAILED", 0],
    ["PROCESSING", 1],
    ["APPLIED", 1],
  ]);
  assert.equal(db.rows[0].version, 4);
});

test("concurrent exact pushes execute one worker and both return its committed terminal result", async () => {
  const db = createDb();
  const entered = deferred();
  const release = deferred();
  const resultId = crypto.randomUUID();
  let saves = 0;
  const screening = createScreening({ save: async () => {
    saves += 1;
    entered.resolve();
    await release.promise;
    return { result: { resultId, overallFlag: "NORMAL", isFlagged: false, ruleVersion: "v1" } };
  } });
  const original = action();
  const body = () => ({ clientBatchId: crypto.randomUUID(), actions: [original] });

  const first = invoke(body(), { db, screening }).promise;
  await entered.promise;
  const duplicate = invoke(body(), { db, screening }).promise;
  await new Promise((resolve) => setImmediate(resolve));
  release.resolve();
  const [firstResponse, duplicateResponse] = await Promise.all([first, duplicate]);

  assert.equal(saves, 1);
  assert.equal(firstResponse.actions[0].status, "APPLIED");
  assert.equal(duplicateResponse.actions[0].status, "APPLIED");
  assert.equal(firstResponse.actions[0].result.resultId, resultId);
  assert.equal(duplicateResponse.actions[0].result.resultId, resultId);
  assert.deepEqual(db.transitions.map(({ status, retryCount }) => [status, retryCount]), [
    ["PENDING", 0],
    ["PROCESSING", 0],
    ["APPLIED", 0],
  ]);
});

test("concurrent retries claim a FAILED action once and cannot regress its terminal result", async () => {
  const db = createDb();
  const original = action();
  const firstScreening = createScreening({ save: async () => { throw new Error("temporary failure"); } });
  await invoke({ clientBatchId: crypto.randomUUID(), actions: [original] }, { db, screening: firstScreening }).promise;

  const entered = deferred();
  const release = deferred();
  const resultId = crypto.randomUUID();
  let retrySaves = 0;
  const retryScreening = createScreening({ save: async () => {
    retrySaves += 1;
    entered.resolve();
    await release.promise;
    return { result: { resultId, overallFlag: "NORMAL", isFlagged: false, ruleVersion: "v1" } };
  } });
  const body = () => ({ clientBatchId: crypto.randomUUID(), actions: [original] });

  const retry = invoke(body(), { db, screening: retryScreening }).promise;
  await entered.promise;
  const duplicateRetry = invoke(body(), { db, screening: retryScreening }).promise;
  await new Promise((resolve) => setImmediate(resolve));
  release.resolve();
  const responses = await Promise.all([retry, duplicateRetry]);

  assert.equal(retrySaves, 1);
  assert.ok(responses.every((response) => response.actions[0].status === "APPLIED"));
  assert.ok(responses.every((response) => response.actions[0].retryCount === 1));
  assert.equal(db.rows[0].status, "APPLIED");
  assert.equal(db.rows[0].version, 4);
  assert.deepEqual(db.transitions.map(({ status, retryCount }) => [status, retryCount]), [
    ["PENDING", 0],
    ["PROCESSING", 0],
    ["FAILED", 0],
    ["PROCESSING", 1],
    ["APPLIED", 1],
  ]);
});

test("a stale PROCESSING lease is CAS-reclaimed while the abandoned attempt cannot own the terminal write", async () => {
  const db = createDb();
  const original = action();
  seedProcessingAction(db, original, new Date(Date.now() - 60_000));
  let saves = 0;
  const screening = createScreening({ save: async () => {
    saves += 1;
    return { result: { resultId: crypto.randomUUID(), overallFlag: "NORMAL", isFlagged: false, ruleVersion: "v1" } };
  } });

  const response = await invoke(
    { clientBatchId: crypto.randomUUID(), actions: [original] },
    { db, screening, processingLeaseMs: 1_000, waitTimeoutMs: 25 },
  ).promise;

  assert.equal(saves, 1);
  assert.equal(response.actions[0].status, "APPLIED");
  assert.equal(response.actions[0].retryCount, 1);
  assert.equal(db.rows[0].version, 3);
  assert.equal(db.rows[0].processingStartedAt, null);
  assert.deepEqual(db.transitions.map(({ sequence, status, retryCount }) => [sequence, status, retryCount]), [
    [0, "PENDING", 0],
    [1, "PROCESSING", 0],
    [2, "PROCESSING", 1],
    [3, "APPLIED", 1],
  ]);
});

test("a live stale worker cannot overwrite the reclaimer or append a false terminal transition", async () => {
  const db = createDb();
  const original = action();
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const staleResultId = crypto.randomUUID();
  const winnerResultId = crypto.randomUUID();
  let saves = 0;
  const screening = createScreening({ save: async () => {
    saves += 1;
    if (saves === 1) {
      firstEntered.resolve();
      await releaseFirst.promise;
      return { result: { resultId: staleResultId, overallFlag: "NORMAL", isFlagged: false, ruleVersion: "v1" } };
    }
    return { result: { resultId: winnerResultId, overallFlag: "NORMAL", isFlagged: false, ruleVersion: "v1" } };
  } });
  const body = () => ({ clientBatchId: crypto.randomUUID(), actions: [original] });
  const options = { db, screening, processingLeaseMs: 1, waitTimeoutMs: 50 };

  const staleWorker = invoke(body(), options).promise;
  await firstEntered.promise;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const reclaimerResponse = await invoke(body(), options).promise;
  releaseFirst.resolve();
  const staleWorkerResponse = await staleWorker;

  assert.equal(saves, 2);
  assert.equal(reclaimerResponse.actions[0].result.resultId, winnerResultId);
  assert.equal(staleWorkerResponse.actions[0].result.resultId, winnerResultId);
  assert.equal(db.rows[0].responseSnapshot.resultId, winnerResultId);
  assert.equal(db.rows[0].version, 3);
  assert.deepEqual(db.transitions.map(({ sequence, status, retryCount }) => [sequence, status, retryCount]), [
    [0, "PENDING", 0],
    [1, "PROCESSING", 0],
    [2, "PROCESSING", 1],
    [3, "APPLIED", 1],
  ]);
});

test("a fresh PROCESSING lease returns a retryable in-progress result without another worker", async () => {
  const db = createDb();
  const original = action();
  seedProcessingAction(db, original, new Date());
  let saves = 0;
  const screening = createScreening({ save: async () => { saves += 1; } });

  const response = await invoke(
    { clientBatchId: crypto.randomUUID(), actions: [original] },
    { db, screening, processingLeaseMs: 60_000, waitTimeoutMs: 5 },
  ).promise;

  assert.equal(saves, 0);
  assert.deepEqual(response.actions[0], {
    clientActionId: original.clientActionId,
    status: "FAILED",
    retryCount: 0,
    errorCode: "SYNC_ACTION_IN_PROGRESS",
  });
  assert.equal(db.rows[0].status, "PROCESSING");
  assert.equal(db.rows[0].version, 1);
  assert.equal(db.transitions.length, 2);
});

test("batch scope authorization occurs before any action is recorded", async () => {
  const db = createDb();
  const screening = createScreening();
  screening.listStations = async () => { throw new AppError(403, "FORBIDDEN", "No active assignment"); };
  const run = invoke({ clientBatchId: crypto.randomUUID(), actions: [action()] }, { db, screening });

  await assert.rejects(run.promise, (error) => error.status === 403 && error.code === "FORBIDDEN");
  assert.equal(db.rows.length, 0);
  assert.equal(db.transitions.length, 0);
});

test("sync schema rejects participant identifiers and profile fields", () => {
  const unsafe = action();
  unsafe.payload.passToken = "secret";
  unsafe.payload.nric = "S1234567A";
  assert.equal(screeningSyncBody.safeParse({ clientBatchId: crypto.randomUUID(), actions: [unsafe] }).success, false);
});

test("eye-health sync actions are applied idempotently", async () => {
  const db = createDb();
  let saves = 0;
  const screening = createScreening({
    save: async () => {
      saves += 1;
      return {
        created: true,
        result: {
          resultId: crypto.randomUUID(),
          overallFlag: "REVIEW",
          isFlagged: true,
          ruleVersion: "VSMS-EH-1.0",
        },
      };
    },
  });
  const eyeAction = action({
    stationType: "EYE_HEALTH",
    payload: {
      registrationId,
      idempotencyKey: crypto.randomUUID(),
      acknowledged: true,
      resultData: {
        cataractRisk: "SUSPECTED",
        glaucomaRisk: "NONE",
        symptomsNoted: false,
        observations: "Lens opacity suspected OD.",
      },
    },
  });

  assert.equal(
    screeningSyncBody.safeParse({ clientBatchId: crypto.randomUUID(), actions: [eyeAction] }).success,
    true,
  );

  const first = invoke({ clientBatchId: crypto.randomUUID(), actions: [eyeAction] }, { db, screening });
  const firstResponse = await first.promise;
  assert.equal(firstResponse.actions[0].status, "APPLIED");
  assert.equal(firstResponse.actions[0].errorCode, undefined);
  assert.equal(saves, 1);
});
