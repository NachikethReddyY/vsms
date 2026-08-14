const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");

const {
  cancelActiveRegistrationQueue,
  getEventQueueStatistics,
  isRegistrationRouteComplete,
  isScreeningResultsComplete,
  recordScreeningFlagAudit,
} = require("../../utils/database/databaseRoutines");
const { ensureTestUser, prisma } = require("../../tests/helpers");

let actor;
let event;
let otherEvent;
let station;
let otherStation;
let registration;
let secondRegistration;

const participantData = (label) => ({
  nric: `TEST-${crypto.randomUUID()}`,
  participantReference: `DBR-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
  firstName: label,
  lastName: "Routine",
  dateOfBirth: new Date("1970-01-01T00:00:00.000Z"),
  gender: "F",
  contactNumber: "+65 6000 2000",
  createdById: actor.id,
  updatedById: actor.id,
  onboardingEventId: event.eventId,
});

const createRegistration = async (label, queueNumber) => {
  const participant = await prisma.participant.create({ data: participantData(label) });
  return prisma.eventRegistration.create({
    data: {
      eventId: event.eventId,
      participantId: participant.id,
      registeredBy: actor.id,
      registrationStatus: "CHECKED_IN",
      participantDisplayName: `${label} Routine`,
      queueNumber,
      idempotencyKey: `database-routine-${label}-${crypto.randomUUID()}`,
      checkedIn: true,
      checkedInAt: new Date(),
    },
  });
};

before(async () => {
  actor = await ensureTestUser("EVENT_MANAGER", `database-routines-${crypto.randomUUID()}`);
  const startsAt = new Date("2026-08-13T00:00:00.000Z");
  const endsAt = new Date("2026-08-14T00:00:00.000Z");
  event = await prisma.event.create({
    data: {
      name: `Database routines ${crypto.randomUUID()}`,
      venue: "Test hall",
      timezone: "Asia/Singapore",
      startsAt,
      endsAt,
      capacity: 20,
      status: "COMPLETED",
      createdByUserId: actor.id,
    },
  });
  otherEvent = await prisma.event.create({
    data: {
      name: `Other database routines ${crypto.randomUUID()}`,
      venue: "Other hall",
      timezone: "Asia/Singapore",
      startsAt,
      endsAt,
      capacity: 20,
      status: "COMPLETED",
      createdByUserId: actor.id,
    },
  });
  station = await prisma.station.create({
    data: { eventId: event.eventId, stationName: "Routine VA", stationType: "VISUAL_ACUITY", stationOrder: 1 },
  });
  otherStation = await prisma.station.create({
    data: { eventId: otherEvent.eventId, stationName: "Other VA", stationType: "VISUAL_ACUITY", stationOrder: 1 },
  });
  registration = await createRegistration("First", 1);
  secondRegistration = await createRegistration("Second", 2);
});

after(async () => prisma.$disconnect());

test("queue statistics execute inside PostgreSQL with deterministic interval semantics", async () => {
  await prisma.queueEntry.create({
    data: {
      registrationId: registration.registrationId,
      stationId: station.stationId,
      queueNumber: 1,
      status: "COMPLETED",
      enteredAt: new Date("2026-08-13T01:00:00.000Z"),
      calledAt: new Date("2026-08-13T01:10:00.000Z"),
      startedAt: new Date("2026-08-13T01:10:00.000Z"),
      completedAt: new Date("2026-08-13T01:20:00.000Z"),
      leftQueueAt: new Date("2026-08-13T01:20:00.000Z"),
    },
  });
  await prisma.queueEntry.create({
    data: {
      registrationId: secondRegistration.registrationId,
      stationId: station.stationId,
      queueNumber: 2,
      status: "WAITING",
      enteredAt: new Date("2026-08-13T02:00:00.000Z"),
    },
  });

  const [statistics] = await getEventQueueStatistics(
    event.eventId,
    new Date("2026-08-13T00:00:00.000Z"),
    new Date("2026-08-14T00:00:00.000Z"),
  );

  assert.equal(statistics.waiting, 1n);
  assert.equal(statistics.active, 0n);
  assert.equal(statistics.completed, 1n);
  assert.equal(statistics.wait_p50, 10);
  assert.equal(statistics.wait_p90, 10);
  assert.equal(statistics.service_p50, 10);
  await assert.rejects(
    getEventQueueStatistics(event.eventId, new Date("2026-08-14T00:00:00.000Z"), new Date("2026-08-13T00:00:00.000Z")),
    /analytics range must have a start before its end/,
  );
});

test("queue cancellation validates event scope, reports affected rows, and is idempotent", async () => {
  await assert.rejects(
    prisma.$transaction((tx) => cancelActiveRegistrationQueue(
      otherEvent.eventId,
      secondRegistration.registrationId,
      new Date(),
      tx,
    )),
    /registration does not belong to the supplied event/,
  );
  assert.equal((await prisma.queueEntry.findFirstOrThrow({ where: { registrationId: secondRegistration.registrationId } })).status, "WAITING");

  const result = await cancelActiveRegistrationQueue(event.eventId, secondRegistration.registrationId, new Date());
  assert.equal(result.count, 1);
  const cancelled = await prisma.queueEntry.findFirstOrThrow({ where: { registrationId: secondRegistration.registrationId } });
  assert.equal(cancelled.status, "CANCELLED");
  assert.ok(cancelled.leftQueueAt instanceof Date);

  const replay = await cancelActiveRegistrationQueue(event.eventId, secondRegistration.registrationId, new Date());
  assert.equal(replay.count, 0);
});

test("route completion is event-scoped, non-vacuous, and reflects unfinished steps", async () => {
  assert.equal(await isRegistrationRouteComplete(event.eventId, registration.registrationId), false);

  const step = await prisma.registrationRouteStep.create({
    data: {
      registrationId: registration.registrationId,
      stationId: station.stationId,
      position: 1,
    },
  });
  assert.equal(await isRegistrationRouteComplete(event.eventId, registration.registrationId), false);

  await prisma.registrationRouteStep.update({
    where: { routeStepId: step.routeStepId },
    data: { completedAt: new Date() },
  });
  assert.equal(await isRegistrationRouteComplete(event.eventId, registration.registrationId), true);
  await assert.rejects(
    isRegistrationRouteComplete(otherEvent.eventId, registration.registrationId),
    /registration does not belong to the supplied event/,
  );
});

test("participant timestamp trigger covers direct SQL updates", async () => {
  const forcedTimestamp = new Date("2020-01-01T00:00:00.000Z");
  await prisma.$executeRaw`
    UPDATE participants
    SET updated_at = ${forcedTimestamp}
    WHERE participant_id = ${registration.participantId}::uuid
  `;
  const updated = await prisma.participant.findUniqueOrThrow({ where: { id: registration.participantId } });
  assert.ok(updated.updatedAt > forcedTimestamp);
});

test("database triggers reject cross-event station relationships", async () => {
  await assert.rejects(
    prisma.queueEntry.create({
      data: {
        registrationId: registration.registrationId,
        stationId: otherStation.stationId,
        queueNumber: 1,
      },
    }),
    /must belong to the same event/,
  );

  await assert.rejects(
    prisma.registrationRouteStep.create({
      data: {
        registrationId: registration.registrationId,
        stationId: otherStation.stationId,
        position: 2,
      },
    }),
    /must belong to the same event/,
  );

  await assert.rejects(
    prisma.screeningResult.create({
      data: {
        registrationId: registration.registrationId,
        stationId: otherStation.stationId,
        recordedByUserId: actor.id,
        screeningType: "VISUAL_ACUITY",
        resultData: { od: "6/6", os: "6/6" },
        overallFlag: "NORMAL",
        isFlagged: false,
        idempotencyKey: crypto.randomUUID(),
      },
    }),
    /must belong to the same event/,
  );

  await assert.rejects(
    prisma.queueMovement.create({
      data: {
        registrationId: registration.registrationId,
        fromStationId: station.stationId,
        toStationId: otherStation.stationId,
        movedBy: actor.id,
        movementReason: "TEST_SCOPE",
      },
    }),
    /must belong to the same event/,
  );
});

test("screening completeness requires a result for every route station", async () => {
  const resultRegistration = await createRegistration("Results", 3);
  await prisma.registrationRouteStep.create({
    data: {
      registrationId: resultRegistration.registrationId,
      stationId: station.stationId,
      position: 1,
    },
  });
  assert.equal(await isScreeningResultsComplete(event.eventId, resultRegistration.registrationId), false);

  const saved = await prisma.screeningResult.create({
    data: {
      registrationId: resultRegistration.registrationId,
      stationId: station.stationId,
      recordedByUserId: actor.id,
      screeningType: "VISUAL_ACUITY",
      resultData: { chartDistanceMetres: 6 },
      overallFlag: "REVIEW",
      isFlagged: true,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  assert.equal(await isScreeningResultsComplete(event.eventId, resultRegistration.registrationId), true);
  await assert.rejects(
    isScreeningResultsComplete(otherEvent.eventId, resultRegistration.registrationId),
    /registration does not belong to the supplied event/,
  );

  const audit = await recordScreeningFlagAudit(saved.resultId, actor.id);
  assert.ok(audit.auditId);
  const auditRow = await prisma.auditLog.findUniqueOrThrow({ where: { id: audit.auditId } });
  assert.equal(auditRow.action, "SCREENING_FLAG_DB_RECORDED");
  assert.equal(auditRow.details.isFlagged, true);
  assert.equal(auditRow.details.resultData, undefined);
});

test("reviewed screening results cannot be inserted, updated, or deleted", async () => {
  const lockedRegistration = await createRegistration("Locked", 4);
  const saved = await prisma.screeningResult.create({
    data: {
      registrationId: lockedRegistration.registrationId,
      stationId: station.stationId,
      recordedByUserId: actor.id,
      screeningType: "VISUAL_ACUITY",
      resultData: { chartDistanceMetres: 6 },
      overallFlag: "NORMAL",
      isFlagged: false,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  await prisma.review.create({
    data: {
      registrationId: lockedRegistration.registrationId,
      reviewedByUserId: actor.id,
      outcome: "COMPLETE",
      urgency: "ROUTINE",
      clinicalSummary: "Signed off for database routine lock.",
    },
  });

  await assert.rejects(
    prisma.screeningResult.update({
      where: { resultId: saved.resultId },
      data: { overallFlag: "URGENT" },
    }),
    /cannot be changed after clinical review/,
  );
  await assert.rejects(
    prisma.screeningResult.delete({ where: { resultId: saved.resultId } }),
    /cannot be changed after clinical review/,
  );
});
