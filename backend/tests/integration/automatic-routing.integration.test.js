const { after, before, describe, test } = require("node:test");
const { expect } = require("expect");
const crypto = require("node:crypto");
const helpers = require("../helpers");
const screeningService = require("../../services/screening/screeningService");
const { assignCheckedInRegistration } = require("../../services/screening/routeAssignmentService");
const { replaceRoute } = require("../../services/screening/routeOverrideService");

const prisma = helpers.prisma;
const fixture = {};

const createRegistration = async (label, withRoute = true) => {
  const participant = await prisma.participant.create({
    data: {
      participantReference: `AUTO-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      firstName: label,
      lastName: "Route",
      dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
      gender: "U",
      contactNumber: `+65${crypto.randomInt(10_000_000, 99_999_999)}`,
      createdById: fixture.manager.id,
      updatedById: fixture.manager.id,
      onboardingEventId: fixture.event.eventId,
    },
  });
  const registration = await prisma.eventRegistration.create({
    data: {
      eventId: fixture.event.eventId,
      participantId: participant.id,
      registeredBy: fixture.manager.id,
      registrationStatus: "CHECKED_IN",
      participantDisplayName: `${label} Route`,
      queueNumber: fixture.nextQueueNumber++,
      idempotencyKey: crypto.randomUUID(),
      checkedIn: true,
      checkedInAt: new Date(),
    },
  });
  if (withRoute) {
    await prisma.registrationRouteStep.createMany({
      data: fixture.stations.map((station, index) => ({ registrationId: registration.registrationId, stationId: station.stationId, position: index + 1 })),
    });
    await prisma.queueEntry.create({
      data: { registrationId: registration.registrationId, stationId: fixture.stations[0].stationId, queueNumber: registration.queueNumber },
    });
  }
  return registration;
};

before(async () => {
  fixture.nextQueueNumber = 100;
  fixture.manager = await helpers.ensureTestUser("EVENT_MANAGER", "automatic-route-manager");
  fixture.screener = await helpers.ensureTestUser("SCREENER", "automatic-route-screener");
  const now = Date.now();
  fixture.event = await prisma.event.create({
    data: { name: `Automatic routing ${crypto.randomUUID()}`, venue: "Route hall", startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 3_600_000), capacity: 500, status: "IN_PROGRESS", createdByUserId: fixture.manager.id },
  });
  for (const [user, role] of [[fixture.manager, "EVENT_MANAGER"], [fixture.screener, "SCREENER"]]) {
    await prisma.eventMembership.create({ data: { eventId: fixture.event.eventId, userId: user.id, addedById: fixture.manager.id, roles: { create: { role, assignedById: fixture.manager.id } } } });
  }
  const shift = await prisma.shift.create({ data: { eventId: fixture.event.eventId, name: "Route shift", startsAt: new Date(now - 1_800_000), endsAt: new Date(now + 1_800_000), status: "ACTIVE" } });
  fixture.stations = [];
  for (const [index, type] of ["VISUAL_ACUITY", "REFRACTION", "COLOUR_VISION"].entries()) {
    fixture.stations.push(await prisma.station.create({ data: { eventId: fixture.event.eventId, stationName: `Route ${type}`, stationType: type, stationOrder: index + 1 } }));
  }
  await prisma.staffAssignment.create({ data: { eventId: fixture.event.eventId, stationId: fixture.stations[0].stationId, shiftId: shift.shiftId, userId: fixture.screener.id, assignedBy: fixture.manager.id, assignmentRole: "SCREENER", status: "CONFIRMED", assignmentStatus: "CONFIRMED" } });
});

after(async () => prisma.$disconnect());

describe("automatic route database guarantees", () => {
  test("simultaneous first saves advance once; replay and correction never advance twice", async () => {
    const registration = await createRegistration("Concurrent");
    const idempotencyKey = crypto.randomUUID();
    const body = { registrationId: registration.registrationId, idempotencyKey, acknowledged: false, resultData: { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 6 }, os: { kind: "FRACTION", denominator: 6 }, withUsualDistanceGlasses: false } };
    const save = () => screeningService.saveVisualAcuity(fixture.event.eventId, fixture.stations[0].stationId, body, fixture.screener);
    const [first, replay] = await Promise.all([save(), save()]);
    expect(first.routeProgression).toEqual(replay.routeProgression);
    expect(await prisma.queueMovement.count({ where: { registrationId: registration.registrationId } })).toBe(1);
    expect(await prisma.queueEntry.count({ where: { registrationId: registration.registrationId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } } })).toBe(1);
    expect((await prisma.eventRegistration.findUniqueOrThrow({ where: { registrationId: registration.registrationId } })).routeVersion).toBe(2);

    const correction = await screeningService.saveVisualAcuity(fixture.event.eventId, fixture.stations[0].stationId, { ...body, idempotencyKey: crypto.randomUUID() }, fixture.screener);
    expect(correction.routeProgression.status).toBe("CORRECTION_SAVED");
    expect(await prisma.queueMovement.count({ where: { registrationId: registration.registrationId } })).toBe(1);
    expect((await prisma.eventRegistration.findUniqueOrThrow({ where: { registrationId: registration.registrationId } })).routeVersion).toBe(2);

    await expect(prisma.queueEntry.create({ data: { registrationId: registration.registrationId, stationId: fixture.stations[2].stationId, queueNumber: registration.queueNumber } })).rejects.toMatchObject({ code: "P2002" });
  });

  test("route overrides use compare-and-swap and unavailable stations remain deferred", async () => {
    const registration = await createRegistration("Override");
    const stationIds = fixture.stations.map(({ stationId }) => stationId);
    const update = () => replaceRoute({ eventId: fixture.event.eventId, registrationId: registration.registrationId, stationIds: [stationIds[0], stationIds[2], stationIds[1]], reasonCode: "QUEUE_BALANCING", expectedVersion: 1, user: fixture.manager });
    const results = await Promise.allSettled([update(), update()]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected").reason.code).toBe("ROUTE_VERSION_CONFLICT");

    await prisma.station.update({ where: { stationId: fixture.stations[1].stationId }, data: { operationalStatus: "PAUSED" } });
    const deferred = await createRegistration("Deferred", false);
    const route = await assignCheckedInRegistration(deferred.registrationId);
    expect(route.steps.map(({ stationId }) => stationId)).toEqual(expect.arrayContaining(stationIds));
    expect(route.steps.at(-1).stationId).toBe(fixture.stations[1].stationId);
    expect(route.currentStation.stationId).not.toBe(fixture.stations[1].stationId);
  });
});
