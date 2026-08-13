const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");

const { cancelActiveRegistrationQueue, getEventQueueStatistics } = require("../../utils/database/databaseRoutines");
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
  nricMasked: "••••123A",
  firstName: label,
  lastName: "Routine",
  dateOfBirth: new Date("1970-01-01T00:00:00.000Z"),
  gender: "F",
  contactNumber: "+65 6000 2000",
  emergencyContact: "+65 6000 2001",
  consentGiven: true,
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
});

test("queue cancellation validates event scope and rolls back a rejected call", async () => {
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

  await cancelActiveRegistrationQueue(event.eventId, secondRegistration.registrationId, new Date());
  const cancelled = await prisma.queueEntry.findFirstOrThrow({ where: { registrationId: secondRegistration.registrationId } });
  assert.equal(cancelled.status, "CANCELLED");
  assert.ok(cancelled.leftQueueAt instanceof Date);
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
        position: 1,
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
