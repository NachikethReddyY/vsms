const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const screeningService = require("../../services/screening/screeningService");

const eventId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const user = { userId: crypto.randomUUID(), systemRole: "STAFF", roles: ["SCREENER"], status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };
const context = {
  requestId: crypto.randomUUID(),
  deviceId: null,
  ipAddress: "203.0.113.42",
  deviceName: "Audit test station",
  userAgent: "node-tests/1.0",
};

const body = {
  registrationId,
  idempotencyKey: "screening-audit-key",
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

function installSuccessMocks(t, audits) {
  replace(t, prisma.eventMembership, "findFirst", async () => ({ id: crypto.randomUUID(), eventId, userId: user.userId, status: "ACTIVE", roles: [{ role: "SCREENER" }], user }));
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Visual Acuity" }));
  replace(t, prisma, "$transaction", async (callback) => callback({
    screeningRequestLedger: {
      findUnique: async () => null,
      create: async ({ data }) => data,
    },
    screeningResult: {
      findUnique: async () => null,
      upsert: async ({ create }) => ({ resultId: crypto.randomUUID(), ...create, version: 1 }),
    },
    eventRegistration: {
      findFirst: async () => ({ registrationId, eventId, registrationStatus: "CHECKED_IN" }),
      update: async () => ({ routeVersion: 2 }),
    },
    registrationRouteStep: {
      findMany: async () => [{
        routeStepId: crypto.randomUUID(), registrationId, stationId, position: 1, completedAt: null,
        station: { stationId, stationName: "Visual Acuity", stationType: "VISUAL_ACUITY", isActive: true, operationalStatus: "AVAILABLE" },
      }],
      updateMany: async () => ({ count: 1 }),
    },
    queueEntry: {
      findFirst: async () => ({ id: crypto.randomUUID(), registrationId, stationId, queueNumber: 1, status: "IN_PROGRESS" }),
      updateMany: async () => ({ count: 1 }),
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return { ...data, id: crypto.randomUUID() };
      },
    },
    domainEvent: { create: async ({ data }) => ({ ...data, domainEventId: crypto.randomUUID() }) },
  }));
}

test("screening save emits a SCREENING_RESULT_RECORDED audit inside the transaction", async (t) => {
  const audits = [];
  installSuccessMocks(t, audits);

  const result = await screeningService.saveVisualAcuity(eventId, stationId, body, user, context);

  assert.equal(result.created, true);
  assert.equal(audits.length, 2);
  const audit = audits.find(({ action }) => action === "SCREENING_RESULT_RECORDED");
  assert.equal(audit.action, "SCREENING_RESULT_RECORDED");
  assert.equal(audit.entityName, "ScreeningResult");
  assert.equal(audit.userId, user.userId);
  assert.equal(audit.requestId, context.requestId);
  assert.equal(audit.ipAddress, context.ipAddress);
  assert.equal(audit.newValue.stationType, "VISUAL_ACUITY");
  assert.equal(audit.newValue.overallFlag, "NORMAL");
  assert.equal(audit.newValue.isFlagged, false);
  assert.equal(audit.newValue.registrationId, registrationId);
  assert.ok(/^[0-9a-f-]{36}$/i.test(audit.entityId));
});

test("screening audit is not emitted on an idempotent replay", async (t) => {
  const audits = [];
  const existing = {
    actorUserId: user.userId,
    eventId,
    registrationId,
    stationId,
    requestFingerprint: screeningService.screeningRequestFingerprint({
      eventId, stationId, registrationId, userId: user.userId, body,
    }),
    resultSnapshot: { resultId: crypto.randomUUID(), resultData: body.resultData, version: 1 },
  };
  replace(t, prisma.eventMembership, "findFirst", async () => ({ id: crypto.randomUUID(), eventId, userId: user.userId, status: "ACTIVE", roles: [{ role: "SCREENER" }], user }));
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Visual Acuity" }));
  replace(t, prisma, "$transaction", async (callback) => callback({
    screeningRequestLedger: {
      findUnique: async () => existing,
      create: async ({ data }) => data,
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return { ...data, id: crypto.randomUUID() };
      },
    },
  }));

  const replay = await screeningService.saveVisualAcuity(eventId, stationId, body, user, context);

  assert.equal(replay.created, false);
  assert.equal(audits.length, 0);
});
