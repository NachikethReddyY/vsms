const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const screeningService = require("../../services/screeningService");

const eventId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const user = { userId: crypto.randomUUID(), systemRole: "STAFF", roles: ["SCREENER"] };

const body = {
  registrationId,
  idempotencyKey: "screening-replay-key",
  acknowledged: false,
  resultData: {
    chartDistanceMetres: 6,
    od: { kind: "FRACTION", denominator: 6 },
    os: { kind: "FRACTION", denominator: 6 },
    withUsualDistanceGlasses: true,
  },
};

function replace(t, target, key, value) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

const fingerprintFor = (request) => screeningService.screeningRequestFingerprint({
  eventId: request.eventId,
  stationId: request.stationId,
  registrationId: request.body.registrationId,
  userId: request.user.userId,
  body: request.body,
});

function installReplayMocks(t, getCurrent, existing, counters = {}) {
  replace(t, prisma.event, "findUnique", async ({ where }) => ({ eventId: where.eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async ({ where }) => {
    const current = getCurrent();
    counters.assignmentChecks = (counters.assignmentChecks || 0) + 1;
    assert.equal(where.eventId, current.eventId);
    assert.equal(where.stationId, current.stationId);
    assert.equal(where.userId, current.user.userId);
    return { id: crypto.randomUUID() };
  });
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Visual Acuity" }));
  replace(t, prisma, "$transaction", async (callback) => callback({
    screeningRequestLedger: { findUnique: async () => existing },
    eventRegistration: { findFirst: async () => {
      const current = getCurrent();
      counters.registrationChecks = (counters.registrationChecks || 0) + 1;
      return { registrationId: current.body.registrationId, registrationStatus: "CHECKED_IN" };
    } },
  }));
}

test("screening idempotency replays only the exact authorized request", async (t) => {
  const original = { eventId, stationId, body, user };
  const existing = {
    actorUserId: user.userId,
    eventId,
    registrationId,
    stationId,
    requestFingerprint: fingerprintFor(original),
    resultSnapshot: { resultId: crypto.randomUUID(), resultData: body.resultData, version: 1 },
  };
  const counters = {};
  installReplayMocks(t, () => original, existing, counters);

  const replay = await screeningService.saveVisualAcuity(eventId, stationId, body, user);

  assert.equal(replay.created, false);
  assert.equal(replay.result, existing.resultSnapshot);
  assert.equal(counters.assignmentChecks, 1);
  assert.equal(counters.registrationChecks || 0, 0);
});

test("screening idempotency rejects cross-scope or payload key reuse", async (t) => {
  const original = { eventId, stationId, body, user };
  const existing = {
    actorUserId: user.userId,
    eventId,
    registrationId,
    stationId,
    requestFingerprint: fingerprintFor(original),
    resultSnapshot: { resultId: crypto.randomUUID(), resultData: body.resultData, version: 1 },
  };
  let current = original;
  const counters = {};
  installReplayMocks(t, () => current, existing, counters);

  const collisions = [
    { name: "actor", user: { ...user, userId: crypto.randomUUID() } },
    { name: "event", eventId: crypto.randomUUID(), stationId: crypto.randomUUID(), body: { ...body, registrationId: crypto.randomUUID() } },
    { name: "station", stationId: crypto.randomUUID() },
    { name: "registration", body: { ...body, registrationId: crypto.randomUUID() } },
    { name: "payload", body: { ...body, resultData: { ...body.resultData, od: { kind: "FRACTION", denominator: 18 } } } },
  ];

  for (const collision of collisions) {
    current = { ...original, ...collision, body: collision.body || original.body, user: collision.user || original.user };
    await assert.rejects(
      screeningService.saveVisualAcuity(current.eventId, current.stationId, current.body, current.user),
      (error) => error.status === 409 && error.code === "IDEMPOTENCY_KEY_REUSED",
      collision.name,
    );
  }
  assert.equal(counters.assignmentChecks, collisions.length);
});

test("screening idempotency race recovery enforces the same replay match", async (t) => {
  const original = { eventId, stationId, body, user };
  const replayingUser = { ...user, userId: crypto.randomUUID() };
  const existing = {
    actorUserId: user.userId,
    eventId,
    registrationId,
    stationId,
    requestFingerprint: fingerprintFor(original),
    resultSnapshot: { resultId: crypto.randomUUID(), resultData: body.resultData, version: 1 },
  };
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async ({ where }) => {
    assert.equal(where.userId, replayingUser.userId);
    return { id: crypto.randomUUID() };
  });
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Visual Acuity" }));
  replace(t, prisma, "$transaction", async () => {
    const error = new Error("idempotency race");
    error.code = "P2002";
    throw error;
  });
  replace(t, prisma.screeningRequestLedger, "findUnique", async () => existing);

  await assert.rejects(
    screeningService.saveVisualAcuity(eventId, stationId, body, replayingUser),
    (error) => error.status === 409 && error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("same-request serializable race returns the committed immutable receipt", async (t) => {
  const original = { eventId, stationId, body, user };
  const snapshot = { resultId: crypto.randomUUID(), resultData: body.resultData, version: 1 };
  const receipt = {
    actorUserId: user.userId,
    eventId,
    registrationId,
    stationId,
    requestFingerprint: fingerprintFor(original),
    resultSnapshot: snapshot,
  };
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Visual Acuity" }));
  replace(t, prisma, "$transaction", async () => {
    const error = new Error("concurrent receipt committed first");
    error.code = "P2034";
    throw error;
  });
  replace(t, prisma.screeningRequestLedger, "findUnique", async () => receipt);

  const replay = await screeningService.saveVisualAcuity(eventId, stationId, body, user);
  assert.equal(replay.created, false);
  assert.equal(replay.result, snapshot);
});

test("screening idempotency stores a canonical fingerprint", async (t) => {
  const request = { eventId, stationId, body, user };
  let saved;
  let receipt;
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Visual Acuity" }));
  replace(t, prisma, "$transaction", async (callback) => callback({
    screeningResult: {
      upsert: async ({ create }) => {
        saved = create;
        return { resultId: crypto.randomUUID(), ...create, version: 1 };
      },
    },
    screeningRequestLedger: {
      findUnique: async () => null,
      create: async ({ data }) => { receipt = data; return data; },
    },
    auditLog: { create: async ({ data }) => data },
    eventRegistration: { findFirst: async () => ({ registrationId, registrationStatus: "CHECKED_IN" }) },
  }));

  const result = await screeningService.saveVisualAcuity(eventId, stationId, body, user);
  const reordered = {
    ...body,
    resultData: {
      withUsualDistanceGlasses: true,
      os: { denominator: 6, kind: "FRACTION" },
      od: { denominator: 6, kind: "FRACTION" },
      chartDistanceMetres: 6,
    },
  };

  assert.equal(result.created, true);
  assert.equal(saved.requestFingerprint, fingerprintFor(request));
  assert.equal(receipt.requestFingerprint, fingerprintFor(request));
  assert.equal(receipt.resultSnapshot.version, 1);
  assert.equal(saved.requestFingerprint, screeningService.screeningRequestFingerprint({
    eventId,
    stationId,
    registrationId,
    userId: user.userId,
    body: reordered,
  }));
});

test("delayed K1 replay returns its immutable result without replacing K2", async (t) => {
  const ledgers = new Map();
  let currentResult = null;

  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Visual Acuity" }));
  replace(t, prisma, "$transaction", async (callback) => callback({
    screeningRequestLedger: {
      findUnique: async ({ where }) => ledgers.get(where.idempotencyKey) || null,
      create: async ({ data }) => {
        if (ledgers.has(data.idempotencyKey)) {
          const error = new Error("duplicate receipt");
          error.code = "P2002";
          throw error;
        }
        ledgers.set(data.idempotencyKey, structuredClone(data));
        return data;
      },
    },
    screeningResult: {
      upsert: async ({ update, create }) => {
        if (!currentResult) {
          currentResult = { resultId: crypto.randomUUID(), ...create, createdAt: new Date(), updatedAt: new Date() };
        } else {
          const nextVersion = currentResult.version + update.version.increment;
          currentResult = { ...currentResult, ...update, version: nextVersion, updatedAt: new Date() };
          delete currentResult.version.increment;
        }
        return structuredClone(currentResult);
      },
    },
    eventRegistration: { findFirst: async () => ({ registrationId, registrationStatus: "CHECKED_IN" }) },
    auditLog: { create: async ({ data }) => data },
  }));

  const k1 = { ...body, idempotencyKey: "screening-K1" };
  const k2 = {
    ...body,
    idempotencyKey: "screening-K2",
    resultData: { ...body.resultData, od: { kind: "FRACTION", denominator: 12 } },
  };

  const first = await screeningService.saveVisualAcuity(eventId, stationId, k1, user);
  const correction = await screeningService.saveVisualAcuity(eventId, stationId, k2, user);
  const delayedReplay = await screeningService.saveVisualAcuity(eventId, stationId, k1, user);

  assert.equal(first.result.version, 1);
  assert.equal(correction.result.version, 2);
  assert.equal(delayedReplay.created, false);
  assert.equal(delayedReplay.result.version, 1);
  assert.deepEqual(delayedReplay.result.resultData, k1.resultData);
  assert.equal(currentResult.version, 2);
  assert.deepEqual(currentResult.resultData, k2.resultData);
});
