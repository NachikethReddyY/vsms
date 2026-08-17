const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { getOfflinePack } = require("../../services/event/offlinePackService");

const eventId = crypto.randomUUID();
const actorId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const staleRegistrationId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const shiftId = crypto.randomUUID();
const now = new Date("2030-01-01T09:00:00.000Z");
const shiftEnd = new Date("2030-01-01T12:00:00.000Z");
const user = { userId: actorId, professionalCategory: "DOCTOR" };

const event = {
  eventId,
  name: "Community screening",
  venue: "Community hall",
  timezone: "Asia/Singapore",
  status: "IN_PROGRESS",
  endsAt: new Date("2030-01-01T18:00:00.000Z"),
  shifts: [{
    shiftId,
    endsAt: shiftEnd,
    staffAssignments: [{ user: { userId: actorId }, assignmentRole: "REVIEWER" }],
  }],
};

test("reviewer pack contains only actionable safe review projections", async () => {
  const reviewEvent = {
    eventId,
    name: event.name,
    venue: event.venue,
    timezone: event.timezone,
    status: "IN_PROGRESS",
  };
  const queueItem = {
    registrationId,
    participantDisplayName: "Patient Seven",
    queueNumber: 7,
    highestFlag: "REFER",
    flaggedResultCount: 1,
    completedStationCount: 1,
    skippedStationCount: 0,
    totalStationCount: 1,
    readyReason: "SCREENING_COMPLETE",
    lastResultAt: now,
    rawNric: "S1234567D",
    passToken: "must-not-pack",
  };
  const detail = {
    event: reviewEvent,
    participant: {
      registrationId,
      participantDisplayName: "Patient Seven",
      queueNumber: 7,
      registrationStatus: "CHECKED_IN",
      maskedNric: "•••••567D",
      dateOfBirth: "1980-01-01",
      gender: "F",
      nric: "S1234567D",
      contactNumber: "+6591234567",
      address: "1 Private Street",
      passToken: "must-not-pack",
    },
    stations: [{
      stationId,
      stationName: "Visual acuity",
      stationType: "VISUAL_ACUITY",
      stationOrder: 1,
      fieldSchemaSnapshot: null,
      status: "COMPLETED",
      signatureObjectKey: "signature-secret",
      result: {
        resultId: crypto.randomUUID(),
        stationId,
        screeningType: "VISUAL_ACUITY",
        resultData: { od: { denominator: 12 }, os: { denominator: 12 } },
        overallFlag: "REFER",
        isFlagged: true,
        flagSummary: "Reduced acuity",
        ruleVersion: "1",
        createdAt: now,
        updatedAt: now,
        passToken: "result-secret",
      },
    }],
    readiness: {
      ready: true,
      readyReason: "SCREENING_COMPLETE",
      completedStationCount: 1,
      skippedStationCount: 0,
      totalStationCount: 1,
      highestFlag: "REFER",
    },
    contextVersion: "a".repeat(64),
    existingReview: null,
    signatureSha256: "b".repeat(64),
    referral: { delivery: { recipient: "private@example.test" } },
  };
  const calls = [];
  const review = {
    listQueue: async () => {
      calls.push("list");
      return { event: reviewEvent, queue: [queueItem, { ...queueItem, registrationId: staleRegistrationId }] };
    },
    getDetail: async (_eventId, requestedRegistrationId) => {
      calls.push(requestedRegistrationId);
      return requestedRegistrationId === staleRegistrationId
        ? {
          ...detail,
          participant: { ...detail.participant, registrationId: staleRegistrationId, registrationStatus: "COMPLETED" },
          existingReview: { reviewId: crypto.randomUUID(), signatureSha256: "c".repeat(64) },
        }
        : detail;
    },
  };
  const authorization = {
    isAdministrator: () => false,
    requireEventRoleAndDuty: async (_eventId, _user, role) => {
      assert.equal(role, "REVIEWER");
      return { shiftId, assignmentRole: role };
    },
  };

  const pack = await getOfflinePack(
    eventId,
    user,
    { deviceId: crypto.randomUUID() },
    { roles: new Set(["REVIEWER"]) },
    {
      authorization,
      review,
      getEvent: async () => event,
      now,
      secret: "x".repeat(32),
    },
  );

  assert.deepEqual(calls, ["list", registrationId, staleRegistrationId]);
  assert.equal(pack.expiresAt, shiftEnd.toISOString());
  assert.equal(pack.capabilities.review, true);
  assert.deepEqual(pack.review.event, reviewEvent);
  assert.deepEqual(pack.review.queue, [{
    registrationId,
    participantDisplayName: "Patient Seven",
    queueNumber: 7,
    highestFlag: "REFER",
    flaggedResultCount: 1,
    completedStationCount: 1,
    skippedStationCount: 0,
    totalStationCount: 1,
    readyReason: "SCREENING_COMPLETE",
    lastResultAt: now,
  }]);
  assert.equal(pack.review.details[0].existingReview, null);
  assert.deepEqual(pack.review.details[0].stations[0].result.resultData, detail.stations[0].result.resultData);

  const serialized = JSON.stringify(pack.review);
  for (const forbidden of [
    "S1234567D",
    "+6591234567",
    "1 Private Street",
    "must-not-pack",
    "signature-secret",
    "private@example.test",
    "signatureSha256",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter the review pack`);
  }
});
