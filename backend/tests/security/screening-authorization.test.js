const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const screeningService = require("../../services/screening/screeningService");
const { stationTypeForTemplate } = require("../../services/event/stationTemplateMapping");

const eventId = crypto.randomUUID();
const stationA = crypto.randomUUID();
const stationB = crypto.randomUUID();
const user = { userId: crypto.randomUUID(), systemRole: "STAFF", roles: ["SCREENER"], status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" };

function replace(t, target, key, value) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

function installMembership(t) {
  replace(t, prisma.eventMembership, "findFirst", async () => ({ id: crypto.randomUUID(), eventId, userId: user.userId, status: "ACTIVE", roles: [{ role: "SCREENER" }] }));
}

test("screening is denied outside an in-progress event", async (t) => {
  installMembership(t);
  let assignmentChecked = false;
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Draft", status: "DRAFT", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => { assignmentChecked = true; return { id: "unexpected" }; });

  await assert.rejects(
    screeningService.listStations(eventId, user),
    (error) => error.status === 409 && error.code === "EVENT_NOT_IN_PROGRESS",
  );
  assert.equal(assignmentChecked, true);
});

test("only a screener assigned to the requested station can read its queue", async (t) => {
  installMembership(t);
  let assignmentWhere;
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async ({ where }) => {
    assignmentWhere = where;
    return where.stationId === stationA ? { id: crypto.randomUUID() } : null;
  });
  replace(t, prisma.station, "findFirst", async ({ where }) => ({ ...where, stationName: "Station A" }));
  replace(t, prisma.queueEntry, "findMany", async ({ where }) => {
    assert.equal(where.stationId, stationA);
    assert.deepEqual(where.status.in, ["WAITING", "CALLED", "IN_PROGRESS"]);
    assert.deepEqual(where.registration, { eventId });
    return [];
  });

  await assert.rejects(
    screeningService.listQueue(eventId, stationB, user),
    (error) => error.status === 403 && error.code === "CURRENT_DUTY_REQUIRED",
  );
  assert.equal(assignmentWhere.assignmentRole, "SCREENER");
  assert.equal(assignmentWhere.stationId, stationB);
  assert.equal(assignmentWhere.shift.status, "ACTIVE");

  const queue = await screeningService.listQueue(eventId, stationA, user);
  assert.deepEqual(queue.registrations, []);
  assert.equal(stationTypeForTemplate({ templateKey: "opaque", stationType: "VISUAL_ACUITY" }), "VISUAL_ACUITY");
  assert.equal(stationTypeForTemplate({ templateKey: "opaque", stationType: "EYE_HEALTH" }), null);
});

test("an administrator remains denied without a screener event membership", async (t) => {
  let eventChecked = false;
  replace(t, prisma.eventMembership, "findFirst", async () => null);
  replace(t, prisma.event, "findUnique", async () => { eventChecked = true; return { eventId, status: "IN_PROGRESS" }; });

  await assert.rejects(
    screeningService.listStations(eventId, { ...user, roles: ["ADMINISTRATOR", "SCREENER"] }),
    (error) => error.status === 403 && error.code === "EVENT_ROLE_REQUIRED",
  );
  assert.equal(eventChecked, true);
});

test("assigned stations publish an offline expiry capped by the event and active shift", async (t) => {
  installMembership(t);
  const eventEndsAt = new Date("2026-08-04T12:00:00.000Z");
  const laterShiftEnd = new Date("2026-08-04T14:00:00.000Z");
  const earlierShiftEnd = new Date("2026-08-04T11:00:00.000Z");
  replace(t, prisma.event, "findUnique", async () => ({
    eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall", endsAt: eventEndsAt,
  }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.staffAssignment, "findMany", async () => ([
    { stationId: stationA, shift: { endsAt: laterShiftEnd } },
    { stationId: stationB, shift: { endsAt: earlierShiftEnd } },
  ]));
  replace(t, prisma.station, "findMany", async ({ where }) => {
    assert.deepEqual(where.stationId.in, [stationA, stationB]);
    return [
      { stationId: stationA, eventId, stationType: "VISUAL_ACUITY", stationName: "VA", stationOrder: 1, isActive: true },
      { stationId: stationB, eventId, stationType: "REFRACTION", stationName: "Refraction", stationOrder: 2, isActive: true },
    ];
  });

  const result = await screeningService.listStations(eventId, user);

  assert.equal(result.stations[0].offlineAccessExpiresAt, eventEndsAt.toISOString());
  assert.equal(result.stations[1].offlineAccessExpiresAt, earlierShiftEnd.toISOString());
});

test("dynamic routes accept schema-driven clinical and CUSTOM stations", async (t) => {
  installMembership(t);
  replace(t, prisma.event, "findUnique", async () => ({ eventId, status: "IN_PROGRESS" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  const { SYSTEM_FIELD_SCHEMAS } = require("../../schemas/dynamicStationSchema");
  replace(t, prisma.station, "findFirst", async ({ where }) => {
    if (where.stationId === stationA) {
      const station = {
        stationId: stationA,
        stationType: "VISUAL_ACUITY",
        stationName: "Visual acuity",
        isActive: true,
        fieldSchemaSnapshot: SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY,
        schemaVersion: 1,
      };
      if (where.stationType?.in && !where.stationType.in.includes(station.stationType)) return null;
      return station;
    }
    const station = {
      stationId: stationB,
      stationType: "CUSTOM",
      stationName: "Notes booth",
      isActive: true,
      fieldSchemaSnapshot: [{ key: "notes", label: "Notes", type: "text", required: false }],
      schemaVersion: 1,
    };
    if (where.stationType?.in && !where.stationType.in.includes(station.stationType)) return null;
    return station;
  });

  const clinicalPreview = await screeningService.previewDynamic(
    eventId,
    stationA,
    {
      resultData: {
        chartDistanceMetres: "6",
        od: { kind: "EXCEPTION", code: "NLP" },
        os: { kind: "FRACTION", denominator: 6 },
        withUsualDistanceGlasses: "unknown",
      },
    },
    user,
  );
  assert.equal(clinicalPreview.overallFlag, "URGENT");
  assert.match(clinicalPreview.ruleVersion, /VSMS-VA-1\.0/);

  const preview = await screeningService.previewDynamic(
    eventId,
    stationB,
    { resultData: { notes: "clear" } },
    user,
  );
  assert.equal(preview.overallFlag, "NORMAL");
});

const visualAcuityResult = {
  chartDistanceMetres: "6",
  od: { kind: "FRACTION", denominator: 6 },
  os: { kind: "FRACTION", denominator: 6 },
  withUsualDistanceGlasses: "no",
};

function installDynamicSaveMocks(t, station) {
  let persisted;
  replace(t, prisma.event, "findUnique", async () => ({ eventId, name: "Live", status: "IN_PROGRESS", venue: "Hall" }));
  replace(t, prisma.staffAssignment, "findFirst", async () => ({ id: crypto.randomUUID() }));
  replace(t, prisma.station, "findFirst", async ({ where }) => {
    if (where.stationType?.in && !where.stationType.in.includes(station.stationType)) return null;
    if (typeof where.stationType === "string" && where.stationType !== station.stationType) return null;
    return station;
  });
  replace(t, prisma, "$transaction", async (callback) => callback({
    screeningRequestLedger: { findUnique: async () => null, create: async ({ data }) => data },
    screeningResult: {
      findUnique: async () => null,
      upsert: async ({ create }) => {
        persisted = { resultId: crypto.randomUUID(), ...create, version: 1 };
        return persisted;
      },
    },
    eventRegistration: {
      findFirst: async () => ({ registrationId: station.registrationId, eventId, registrationStatus: "CHECKED_IN" }),
      update: async () => ({ routeVersion: 2 }),
    },
    registrationRouteStep: {
      findMany: async () => [{
        routeStepId: crypto.randomUUID(),
        registrationId: station.registrationId,
        stationId: station.stationId,
        position: 1,
        completedAt: null,
        station: {
          stationId: station.stationId,
          stationName: station.stationName,
          stationType: station.stationType,
          isActive: true,
          operationalStatus: "AVAILABLE",
        },
      }],
      updateMany: async () => ({ count: 1 }),
    },
    queueEntry: {
      findFirst: async () => ({ id: crypto.randomUUID(), registrationId: station.registrationId, stationId: station.stationId, queueNumber: 1, status: "IN_PROGRESS" }),
      updateMany: async () => ({ count: 1 }),
    },
    auditLog: { create: async ({ data }) => ({ ...data, id: crypto.randomUUID() }) },
    domainEvent: { create: async ({ data }) => ({ ...data, domainEventId: crypto.randomUUID() }) },
  }));
  return () => persisted;
}

test("a built-in station created before this PR still opens and accepts a result after the upgrade", async (t) => {
  installMembership(t);
  const registrationId = crypto.randomUUID();
  replace(t, prisma.staffAssignment, "findMany", async () => ([{
    stationId: stationA,
    shift: { endsAt: new Date("2026-08-04T12:00:00.000Z") },
  }]));
  replace(t, prisma.station, "findMany", async () => ([{
    stationId: stationA,
    eventId,
    stationType: "VISUAL_ACUITY",
    stationName: "VA",
    stationOrder: 1,
    isActive: true,
    fieldSchemaSnapshot: null,
  }]));
  const persisted = installDynamicSaveMocks(t, {
    stationId: stationA,
    eventId,
    stationType: "VISUAL_ACUITY",
    stationName: "Visual acuity",
    isActive: true,
    fieldSchemaSnapshot: null,
    schemaVersion: null,
    registrationId,
  });

  const opened = await screeningService.listStations(eventId, user);
  assert.ok(opened.stations[0].fieldSchemaSnapshot?.some((field) => field.key === "chartDistanceMetres"));

  const preview = await screeningService.previewDynamic(eventId, stationA, { resultData: visualAcuityResult }, user);
  assert.equal(preview.overallFlag, "NORMAL");

  const saved = await screeningService.saveDynamic(eventId, stationA, {
    registrationId,
    idempotencyKey: "legacy-va-upgrade",
    acknowledged: false,
    resultData: visualAcuityResult,
  }, user);
  assert.equal(saved.created, true);
  assert.equal(saved.result.resultData.chartDistanceMetres, 6);
  assert.equal(persisted().resultData.chartDistanceMetres, 6);
});

test("an extra customized clinical field survives save and appears in the result used by the reviewer", async (t) => {
  installMembership(t);
  const { SYSTEM_FIELD_SCHEMAS } = require("../../schemas/dynamicStationSchema");
  const registrationId = crypto.randomUUID();
  const persisted = installDynamicSaveMocks(t, {
    stationId: stationA,
    eventId,
    stationType: "VISUAL_ACUITY",
    stationName: "Visual acuity",
    isActive: true,
    fieldSchemaSnapshot: [
      ...SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY,
      { key: "screenerComment", label: "Screener comment", type: "text", required: true },
    ],
    schemaVersion: 2,
    registrationId,
  });

  const resultData = { ...visualAcuityResult, screenerComment: "Participant needed extra time." };
  const saved = await screeningService.saveDynamic(eventId, stationA, {
    registrationId,
    idempotencyKey: "extra-clinical-field",
    acknowledged: false,
    resultData,
  }, user);

  assert.equal(saved.result.resultData.screenerComment, "Participant needed extra time.");
  assert.equal(saved.result.resultData.chartDistanceMetres, 6);
  assert.equal(persisted().resultData.screenerComment, "Participant needed extra time.");
});
