const { test, describe, before, after } = require("node:test");
const { expect } = require("expect");
const crypto = require("crypto");
require("dotenv").config();

let helpers;
let fixture;
let processScreeningSync;
let requestFingerprint;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOCAL_HTTPS = "false";
  process.env.JWT_ACCESS_SECRET = "test-only-access-secret-with-at-least-thirty-two-characters";
  helpers = require("../helpers");
  ({ processScreeningSync, requestFingerprint } = require("../../services/screening/syncService"));

  const screener = await helpers.ensureTestUser("STAFF");
  const role = await helpers.prisma.role.upsert({
    where: { roleName: "SCREENER" },
    update: {},
    create: { roleName: "SCREENER" },
  });
  await helpers.prisma.userRole.upsert({
    where: { userId_roleId: { userId: screener.id, roleId: role.id } },
    update: {},
    create: { userId: screener.id, roleId: role.id },
  });

  const now = Date.now();
  const event = await helpers.prisma.event.create({
    data: {
      name: `Sync integration ${crypto.randomUUID().slice(0, 8)}`,
      venue: "Integration hall",
      timezone: "Asia/Singapore",
      startsAt: new Date(now - 60 * 60 * 1000),
      endsAt: new Date(now + 60 * 60 * 1000),
      capacity: 10,
      status: "IN_PROGRESS",
      createdByUserId: screener.id,
    },
  });
  const membership = await helpers.prisma.eventMembership.create({
    data: {
      eventId: event.eventId,
      userId: screener.id,
      addedById: screener.id,
      roles: { create: { role: "SCREENER", assignedById: screener.id } },
    },
  });
  const shift = await helpers.prisma.shift.create({
    data: {
      eventId: event.eventId,
      name: "Active sync shift",
      startsAt: new Date(now - 30 * 60 * 1000),
      endsAt: new Date(now + 30 * 60 * 1000),
      requiredStaff: 1,
      status: "ACTIVE",
    },
  });
  const station = await helpers.prisma.station.create({
    data: {
      eventId: event.eventId,
      stationName: "Visual Acuity",
      stationType: "VISUAL_ACUITY",
      stationOrder: 1,
    },
  });
  await helpers.prisma.staffAssignment.create({
    data: {
      eventId: event.eventId,
      stationId: station.stationId,
      shiftId: shift.shiftId,
      userId: screener.id,
      assignedBy: screener.id,
      assignmentRole: "SCREENER",
      assignmentStatus: "CONFIRMED",
      status: "CONFIRMED",
    },
  });
  const participant = await helpers.prisma.participant.create({
    data: {
      participantReference: `SYNC-${crypto.randomUUID().slice(0, 8)}`,
      nric: `integration-${crypto.randomUUID()}`,
      nricMasked: "••••0001",
      firstName: "Sync",
      lastName: "Participant",
      dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
      gender: "X",
      contactNumber: "+65 8000 0001",
      emergencyContact: "+65 8000 0002",
      consentGiven: true,
      createdById: screener.id,
      updatedById: screener.id,
      onboardingEventId: event.eventId,
    },
  });
  const registration = await helpers.prisma.eventRegistration.create({
    data: {
      eventId: event.eventId,
      participantId: participant.id,
      registeredBy: screener.id,
      registrationStatus: "CHECKED_IN",
      participantDisplayName: "Sync Participant",
      queueNumber: 1,
      idempotencyKey: crypto.randomUUID(),
      passToken: `secret-${crypto.randomUUID()}`,
      checkedIn: true,
    },
  });
  fixture = { screener, event, station, participant, registration, membership };
});

after(async () => {
  if (fixture) {
    await helpers.prisma.syncAction.deleteMany({ where: { userId: fixture.screener.id } });
    await helpers.prisma.screeningRequestLedger.deleteMany({ where: { registrationId: fixture.registration.registrationId } });
    await helpers.prisma.screeningResult.deleteMany({ where: { registrationId: fixture.registration.registrationId } });
    await helpers.prisma.event.delete({ where: { eventId: fixture.event.eventId } });
    await helpers.prisma.participant.delete({ where: { id: fixture.participant.id } });
  }
  await helpers.prisma.$disconnect();
});

describe("screening sync API", () => {
  test("reauthorizes, applies idempotently, records transitions, and returns a sanitized pull", async () => {
    const clientActionId = crypto.randomUUID();
    const action = {
      clientActionId,
      stationId: fixture.station.stationId,
      stationType: "VISUAL_ACUITY",
      payload: {
        registrationId: fixture.registration.registrationId,
        idempotencyKey: crypto.randomUUID(),
        acknowledged: false,
        resultData: {
          chartDistanceMetres: 6,
          od: { kind: "FRACTION", denominator: 6 },
          os: { kind: "FRACTION", denominator: 6 },
          withUsualDistanceGlasses: true,
        },
      },
    };
    const push = (currentAction = action) => processScreeningSync(
      fixture.event.eventId,
      { clientBatchId: crypto.randomUUID(), actions: [currentAction] },
      { userId: fixture.screener.id, systemRole: "STAFF", roles: ["SCREENER"], status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" },
      { requestId: crypto.randomUUID(), deviceId: null, deviceName: "integration", ipAddress: "127.0.0.1" },
    );

    const [first, concurrentReplay] = await Promise.all([push(), push()]);
    expect(first.actions[0]).toEqual(expect.objectContaining({ clientActionId, status: "APPLIED", retryCount: 0 }));
    expect(concurrentReplay.actions[0]).toEqual(expect.objectContaining({ clientActionId, status: "APPLIED", retryCount: 0 }));
    expect(concurrentReplay.actions[0].result).toEqual(first.actions[0].result);
    const registration = first.pull.stations[0].registrations[0];
    expect(registration.participantDisplayName).toBe("Sync Participant");
    expect(registration.passToken).toBeUndefined();
    expect(registration.participant).toBeUndefined();

    const replay = await push();
    expect(replay.actions[0].status).toBe("APPLIED");

    const stored = await helpers.prisma.syncAction.findFirstOrThrow({
      where: { userId: fixture.screener.id, clientActionId },
      include: { transitions: { orderBy: { sequence: "asc" } } },
    });
    expect(stored.payload).toEqual({ schemaVersion: 1, stationType: "VISUAL_ACUITY" });
    expect(stored.version).toBe(2);
    expect(stored.transitions.map(({ sequence, status, retryCount }) => [sequence, status, retryCount])).toEqual([
      [0, "PENDING", 0],
      [1, "PROCESSING", 0],
      [2, "APPLIED", 0],
    ]);
    expect(await helpers.prisma.screeningResult.count({
      where: { registrationId: fixture.registration.registrationId, stationId: fixture.station.stationId },
    })).toBe(1);
    const serialized = JSON.stringify(stored);
    for (const forbidden of ["resultData", "passToken", "nric", "participantDisplayName"]) {
      expect(serialized).not.toContain(forbidden);
    }

    const collision = await push({ ...action, payload: { ...action.payload, acknowledged: true } });
    expect(collision.actions[0]).toEqual(expect.objectContaining({
      status: "CONFLICT",
      errorCode: "SYNC_IDEMPOTENCY_REUSED",
    }));

    const staleAction = {
      ...action,
      clientActionId: crypto.randomUUID(),
      payload: { ...action.payload, idempotencyKey: crypto.randomUUID() },
    };
    const stale = await helpers.prisma.syncAction.create({
      data: {
        userId: fixture.screener.id,
        eventId: fixture.event.eventId,
        stationId: fixture.station.stationId,
        clientActionId: staleAction.clientActionId,
        requestFingerprint: requestFingerprint({
          eventId: fixture.event.eventId,
          userId: fixture.screener.id,
          action: staleAction,
        }),
        operation: "UPDATE",
        entityType: "ScreeningResult",
        entityId: fixture.registration.registrationId,
        payload: { schemaVersion: 1, stationType: "VISUAL_ACUITY" },
        status: "PROCESSING",
        retryCount: 0,
        version: 1,
        processingStartedAt: new Date(Date.now() - 60_000),
        transitions: {
          create: [
            { sequence: 0, status: "PENDING", retryCount: 0 },
            { sequence: 1, status: "PROCESSING", retryCount: 0 },
          ],
        },
      },
    });
    const reclaimed = await processScreeningSync(
      fixture.event.eventId,
      { clientBatchId: crypto.randomUUID(), actions: [staleAction] },
      { userId: fixture.screener.id, systemRole: "STAFF", roles: ["SCREENER"], status: "ACTIVE", approvalState: "APPROVED", accessState: "ENABLED" },
      { requestId: crypto.randomUUID(), deviceId: null, deviceName: "integration", ipAddress: "127.0.0.1" },
      { processingLeaseMs: 1_000 },
    );
    expect(reclaimed.actions[0]).toEqual(expect.objectContaining({ status: "APPLIED", retryCount: 1 }));
    const reclaimedRow = await helpers.prisma.syncAction.findUniqueOrThrow({
      where: { id: stale.id },
      include: { transitions: { orderBy: { sequence: "asc" } } },
    });
    expect(reclaimedRow.version).toBe(3);
    expect(reclaimedRow.processingStartedAt).toBeNull();
    expect(reclaimedRow.transitions.map(({ sequence, status, retryCount }) => [sequence, status, retryCount])).toEqual([
      [0, "PENDING", 0],
      [1, "PROCESSING", 0],
      [2, "PROCESSING", 1],
      [3, "APPLIED", 1],
    ]);
  });
});
