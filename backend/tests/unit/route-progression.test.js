const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { advanceAfterFirstResult } = require("../../services/screening/routeProgressionService");

const registrationId = crypto.randomUUID();
const eventId = crypto.randomUUID();
const userId = crypto.randomUUID();
const currentStationId = crypto.randomUUID();
const nextStationId = crypto.randomUUID();

const step = (routeStepId, stationId, position, operationalStatus = "AVAILABLE") => ({
  routeStepId,
  registrationId,
  stationId,
  position,
  completedAt: null,
  station: {
    stationId,
    stationName: position === 1 ? "Visual acuity" : "Refraction",
    stationType: position === 1 ? "VISUAL_ACUITY" : "REFRACTION",
    isActive: true,
    operationalStatus,
  },
});

const progressionTx = ({ nextStatus = "AVAILABLE", availability = null } = {}) => {
  const currentQueue = {
    id: crypto.randomUUID(),
    registrationId,
    stationId: currentStationId,
    queueNumber: 12,
    status: "IN_PROGRESS",
  };
  const state = { queues: [currentQueue], movements: [], audit: [], routeVersion: 1 };
  const steps = [
    step(crypto.randomUUID(), currentStationId, 1),
    step(crypto.randomUUID(), nextStationId, 2, nextStatus),
  ];
  const tx = {
    registrationRouteStep: {
      findMany: async () => steps,
      updateMany: async ({ where, data }) => {
        const found = steps.find(({ routeStepId }) => routeStepId === where.routeStepId);
        if (!found || found.completedAt) return { count: 0 };
        found.completedAt = data.completedAt;
        return { count: 1 };
      },
    },
    queueEntry: {
      findFirst: async () => state.queues.find(({ status }) => ["WAITING", "CALLED", "IN_PROGRESS"].includes(status)) || null,
      updateMany: async ({ where, data }) => {
        const found = state.queues.find(({ id }) => id === where.id);
        if (!found || !["WAITING", "CALLED", "IN_PROGRESS"].includes(found.status)) return { count: 0 };
        Object.assign(found, data);
        return { count: 1 };
      },
      create: async ({ data }) => {
        const created = { id: crypto.randomUUID(), ...data };
        state.queues.push(created);
        return created;
      },
    },
    eventRegistration: {
      findUnique: async () => ({ registrationId, eventId, queueNumber: 12, registrationStatus: "CHECKED_IN" }),
      update: async () => ({ routeVersion: ++state.routeVersion }),
    },
    eventStationAvailability: { findFirst: async () => availability },
    queueMovement: { create: async ({ data }) => { state.movements.push(data); return data; } },
    auditLog: { create: async ({ data }) => { state.audit.push(data); return data; } },
  };
  return { state, tx };
};

test("first result completion closes the current queue and creates exactly one next queue", async () => {
  const { state, tx } = progressionTx();
  const result = await advanceAfterFirstResult({
    tx, registrationId, eventId, stationId: currentStationId, actorUserId: userId,
  });

  assert.equal(result.routeProgression.status, "ADDED_TO_QUEUE");
  assert.equal(result.routeProgression.nextStation.stationId, nextStationId);
  assert.equal(result.routeProgression.nextQueue.queueNumber, 12);
  assert.equal(state.queues.filter(({ status }) => ["WAITING", "CALLED", "IN_PROGRESS"].includes(status)).length, 1);
  assert.equal(state.queues[0].status, "COMPLETED");
  assert.equal(state.movements.length, 1);
  assert.equal(state.routeVersion, 2);
  assert.equal(JSON.stringify(result.routeProgression).includes("routeStepId"), false);
  assert.equal(JSON.stringify(result.routeProgression).includes(userId), false);
});

test("an unavailable next station blocks progression without claiming queue entry", async () => {
  const { state, tx } = progressionTx({ nextStatus: "PAUSED" });
  const result = await advanceAfterFirstResult({
    tx, registrationId, eventId, stationId: currentStationId, actorUserId: userId,
  });

  assert.equal(result.routeProgression.status, "BLOCKED");
  assert.equal(result.routeProgression.nextQueue, null);
  assert.equal(state.queues.filter(({ status }) => ["WAITING", "CALLED", "IN_PROGRESS"].includes(status)).length, 0);
  assert.equal(state.movements.length, 0);
});

test("a stale or simultaneous progression cannot advance a second time", async () => {
  const { tx } = progressionTx();
  await advanceAfterFirstResult({
    tx, registrationId, eventId, stationId: currentStationId, actorUserId: userId,
  });
  await assert.rejects(
    advanceAfterFirstResult({
      tx, registrationId, eventId, stationId: currentStationId, actorUserId: userId,
    }),
    (error) => error.code === "ROUTE_STATION_MISMATCH" && error.status === 409,
  );
});
