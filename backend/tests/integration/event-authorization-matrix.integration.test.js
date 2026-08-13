const { after, before, describe, test } = require("node:test");
const { expect } = require("expect");
const crypto = require("node:crypto");
const request = require("supertest");
const helpers = require("../helpers");
const app = require("../../app");

const prisma = helpers.prisma;
const fixture = {};
const auth = (user) => ({ Authorization: `Bearer ${helpers.accessTokenFor(user)}` });

const createParticipant = (label, creator, onboardingEventId = null) => prisma.participant.create({
  data: {
    participantReference: `MAT-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    firstName: `MatrixScope${label}`,
    lastName: "Participant",
    dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
    gender: "U",
    contactNumber: `+65${crypto.randomInt(1_000_0000, 9_999_9999)}`,
    createdById: creator.id,
    updatedById: creator.id,
    onboardingEventId,
  },
});

before(async () => {
  fixture.managerA = await helpers.ensureTestUser("EVENT_MANAGER", "matrix-manager-a");
  fixture.managerB = await helpers.ensureTestUser("EVENT_MANAGER", "matrix-manager-b");
  fixture.registrationA = await helpers.ensureTestUser("REGISTRATION_OFFICER", "matrix-registration-a");
  fixture.screenerA = await helpers.ensureTestUser("SCREENER", "matrix-screener-a");
  fixture.reviewerA = await helpers.ensureTestUser("REVIEWER", "matrix-reviewer-a");
  fixture.reviewerB = await helpers.ensureTestUser("REVIEWER", "matrix-reviewer-b");
  fixture.supportA = await helpers.ensureTestUser("SUPPORT", "matrix-support-a");
  fixture.admin = await helpers.ensureTestUser("ADMINISTRATOR", "matrix-platform-admin");

  const startsAt = new Date(Date.now() - 60 * 60_000);
  const endsAt = new Date(Date.now() + 6 * 60 * 60_000);
  const createEvent = (name, creator) => prisma.event.create({
    data: { name, venue: "Authorization Matrix Hall", startsAt, endsAt, capacity: 50, status: "IN_PROGRESS", createdByUserId: creator.id },
  });
  [fixture.eventA, fixture.eventB] = await Promise.all([
    createEvent(`Matrix A ${crypto.randomUUID()}`, fixture.managerA),
    createEvent(`Matrix B ${crypto.randomUUID()}`, fixture.managerB),
  ]);

  const addMembership = (event, member, role, addedBy) => prisma.eventMembership.create({
    data: {
      eventId: event.eventId,
      userId: member.id,
      addedById: addedBy.id,
      roles: { create: { role, assignedById: addedBy.id } },
    },
  });
  await Promise.all([
    addMembership(fixture.eventA, fixture.managerA, "EVENT_MANAGER", fixture.managerA),
    addMembership(fixture.eventA, fixture.registrationA, "REGISTRATION", fixture.managerA),
    addMembership(fixture.eventA, fixture.screenerA, "SCREENER", fixture.managerA),
    addMembership(fixture.eventA, fixture.reviewerA, "REVIEWER", fixture.managerA),
    addMembership(fixture.eventA, fixture.supportA, "SUPPORT", fixture.managerA),
    addMembership(fixture.eventB, fixture.managerB, "EVENT_MANAGER", fixture.managerB),
    addMembership(fixture.eventB, fixture.reviewerB, "REVIEWER", fixture.managerB),
  ]);

  [fixture.shiftA, fixture.shiftB] = await Promise.all([
    prisma.shift.create({ data: { eventId: fixture.eventA.eventId, name: "Matrix A active", startsAt, endsAt, status: "ACTIVE" } }),
    prisma.shift.create({ data: { eventId: fixture.eventB.eventId, name: "Matrix B active", startsAt, endsAt, status: "ACTIVE" } }),
  ]);
  [fixture.stationA, fixture.stationA2, fixture.stationB] = await Promise.all([
    prisma.station.create({ data: { eventId: fixture.eventA.eventId, stationName: "Matrix A VA", stationType: "VISUAL_ACUITY", stationOrder: 1 } }),
    prisma.station.create({ data: { eventId: fixture.eventA.eventId, stationName: "Matrix A Refraction", stationType: "REFRACTION", stationOrder: 2 } }),
    prisma.station.create({ data: { eventId: fixture.eventB.eventId, stationName: "Matrix B VA", stationType: "VISUAL_ACUITY", stationOrder: 1 } }),
  ]);
  const assign = (event, shift, member, role, stationId = null) => prisma.staffAssignment.create({
    data: {
      eventId: event.eventId,
      shiftId: shift.shiftId,
      stationId,
      userId: member.id,
      assignedBy: role === "REVIEWER" && event.eventId === fixture.eventB.eventId ? fixture.managerB.id : fixture.managerA.id,
      assignmentRole: role,
      status: "CONFIRMED",
      assignmentStatus: "CONFIRMED",
    },
  });
  await Promise.all([
    assign(fixture.eventA, fixture.shiftA, fixture.registrationA, "REGISTRATION"),
    assign(fixture.eventA, fixture.shiftA, fixture.screenerA, "SCREENER", fixture.stationA.stationId),
    assign(fixture.eventA, fixture.shiftA, fixture.reviewerA, "REVIEWER"),
    assign(fixture.eventA, fixture.shiftA, fixture.supportA, "SUPPORT"),
    assign(fixture.eventB, fixture.shiftB, fixture.reviewerB, "REVIEWER"),
  ]);

  fixture.participantA = await createParticipant("RegisteredA", fixture.registrationA, fixture.eventA.eventId);
  fixture.participantB = await createParticipant("RegisteredB", fixture.managerB, fixture.eventB.eventId);
  fixture.onboardingA = await createParticipant("OnboardingA", fixture.registrationA, fixture.eventA.eventId);
  fixture.unrelatedParticipant = await createParticipant("Unrelated", fixture.managerB);
  const createRegistration = (event, participant, registeredBy, queueNumber) => prisma.eventRegistration.create({
    data: {
      eventId: event.eventId,
      participantId: participant.id,
      registeredBy: registeredBy.id,
      registrationStatus: "CHECKED_IN",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber,
      idempotencyKey: crypto.randomUUID(),
      checkedIn: true,
      checkedInAt: new Date(),
    },
  });
  [fixture.registrationRecordA, fixture.registrationRecordB] = await Promise.all([
    createRegistration(fixture.eventA, fixture.participantA, fixture.registrationA, 1),
    createRegistration(fixture.eventB, fixture.participantB, fixture.managerB, 1),
  ]);
  await prisma.registrationRouteStep.create({
    data: { registrationId: fixture.registrationRecordA.registrationId, stationId: fixture.stationA.stationId, position: 1 },
  });
  fixture.queueA = await prisma.queueEntry.create({
    data: { registrationId: fixture.registrationRecordA.registrationId, stationId: fixture.stationA.stationId, queueNumber: 1 },
  });

  fixture.reviewB = await prisma.review.create({
    data: {
      registrationId: fixture.registrationRecordB.registrationId,
      reviewedByUserId: fixture.reviewerB.id,
      outcome: "REFER",
      urgency: "ROUTINE",
      clinicalSummary: "Matrix referral fixture",
    },
  });
  fixture.referralB = await prisma.referral.create({
    data: {
      reviewId: fixture.reviewB.reviewId,
      registrationId: fixture.registrationRecordB.registrationId,
      createdByUserId: fixture.reviewerB.id,
      destinationName: "Matrix Clinic",
      reason: "Authorization matrix referral",
      urgency: "ROUTINE",
    },
  });
  fixture.documentB = await prisma.documentArtifact.create({
    data: {
      reviewId: fixture.reviewB.reviewId,
      referralId: fixture.referralB.referralId,
      documentType: "REFERRAL_PDF",
      storageKey: `matrix/${crypto.randomUUID()}.pdf`,
      contentHash: "b".repeat(64),
      mimeType: "application/pdf",
      sizeBytes: 1,
      generatedByUserId: fixture.reviewerB.id,
    },
  });
  fixture.queueB = await prisma.queueEntry.create({
    data: { registrationId: fixture.registrationRecordB.registrationId, stationId: fixture.stationB.stationId, queueNumber: 1 },
  });
});

after(async () => prisma.$disconnect());

describe("two-event route authorization matrix", () => {
  test("registration explicit and compatibility routes stay inside the assigned event", async () => {
    const allowedV1 = await request(app)
      .get(`/api/v1/events/${fixture.eventA.eventId}/registrations`)
      .set(auth(fixture.registrationA));
    const allowedLegacy = await request(app)
      .get(`/api/events/${fixture.eventA.eventId}/registrations`)
      .set(auth(fixture.registrationA));
    const deniedExplicit = await request(app)
      .get(`/api/v1/events/${fixture.eventB.eventId}/registrations`)
      .set(auth(fixture.registrationA));
    const deniedDerived = await request(app)
      .get(`/api/v1/registrations/${fixture.registrationRecordB.registrationId}`)
      .set(auth(fixture.registrationA));

    expect(allowedV1.status).toBe(200);
    expect(allowedLegacy.status).toBe(200);
    expect(deniedExplicit.status).toBe(403);
    expect(deniedDerived.status).toBe(403);
  });

  test("participant search allows registered and creator-owned onboarding records but not unrelated discovery", async () => {
    const response = await request(app)
      .get("/api/v1/participants?name=MatrixScope")
      .set(auth(fixture.registrationA))
      .set("X-Event-Id", fixture.eventA.eventId);
    expect(response.status).toBe(200);
    const ids = response.body.participants.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([fixture.participantA.id, fixture.onboardingA.id]));
    expect(ids).not.toContain(fixture.participantB.id);
    expect(ids).not.toContain(fixture.unrelatedParticipant.id);
  });

  test("screening and review or referral routes reject the other event", async () => {
    const screeningAllowed = await request(app)
      .get(`/api/v1/events/${fixture.eventA.eventId}/stations/${fixture.stationA.stationId}/queue`)
      .set(auth(fixture.screenerA));
    const screeningDenied = await request(app)
      .get(`/api/v1/events/${fixture.eventB.eventId}/stations/${fixture.stationB.stationId}/queue`)
      .set(auth(fixture.screenerA));
    const reviewAllowed = await request(app)
      .get(`/api/v1/events/${fixture.eventA.eventId}/reviews`)
      .set(auth(fixture.reviewerA));
    const reviewDenied = await request(app)
      .get(`/api/v1/events/${fixture.eventB.eventId}/reviews`)
      .set(auth(fixture.reviewerA));
    const referralDenied = await request(app)
      .get(`/api/v1/events/${fixture.eventB.eventId}/referrals/${fixture.referralB.referralId}/documents/${fixture.documentB.documentId}`)
      .set(auth(fixture.reviewerA));

    expect(screeningAllowed.status).toBe(200);
    expect(screeningDenied.status).toBe(403);
    expect(reviewAllowed.status).toBe(200);
    expect(reviewDenied.status).toBe(403);
    expect(referralDenied.status).toBe(403);
  });

  test("retired manual joins stay unavailable while queue reads and calls reauthorize event duties", async () => {
    const retiredJoin = await request(app)
      .post(`/api/v1/queues/events/${fixture.eventA.eventId}/stations/${fixture.stationA.stationId}/join`)
      .set(auth(fixture.screenerA))
      .send({ registrationId: fixture.registrationRecordA.registrationId });
    const retiredWrongStationJoin = await request(app)
      .post(`/api/v1/queues/events/${fixture.eventA.eventId}/stations/${fixture.stationA2.stationId}/join`)
      .set(auth(fixture.screenerA))
      .send({ registrationId: fixture.registrationRecordA.registrationId });
    const called = await request(app)
      .patch(`/api/v1/queues/events/${fixture.eventA.eventId}/entries/${fixture.queueA.id}/call`)
      .set(auth(fixture.screenerA));
    const crossEventCall = await request(app)
      .patch(`/api/v1/queues/events/${fixture.eventB.eventId}/entries/${fixture.queueB.id}/call`)
      .set(auth(fixture.screenerA));
    const explicitAllowed = await request(app)
      .get(`/api/v1/queues/events/${fixture.eventA.eventId}/participants/${fixture.registrationRecordA.registrationId}`)
      .set(auth(fixture.supportA));
    const compatibilityAllowed = await request(app)
      .get(`/api/v1/queues/participant/${fixture.registrationRecordA.registrationId}`)
      .set(auth(fixture.supportA));
    const explicitDenied = await request(app)
      .get(`/api/v1/queues/events/${fixture.eventB.eventId}/participants/${fixture.registrationRecordB.registrationId}`)
      .set(auth(fixture.supportA));
    const compatibilityDenied = await request(app)
      .get(`/api/v1/queues/participant/${fixture.registrationRecordB.registrationId}`)
      .set(auth(fixture.supportA));

    expect(retiredJoin.status).toBe(404);
    expect(retiredWrongStationJoin.status).toBe(404);
    expect(called.status).toBe(200);
    expect(called.body.data.status).toBe("CALLED");
    expect(crossEventCall.status).toBe(403);
    expect(explicitAllowed.status).toBe(200);
    expect(compatibilityAllowed.status).toBe(200);
    expect(explicitDenied.status).toBe(403);
    expect(compatibilityDenied.status).toBe(403);
  });

  test("platform administrators receive management analytics but no implicit operational access", async () => {
    const requests = [
      request(app).get(`/api/v1/events/${fixture.eventA.eventId}/registrations`).set(auth(fixture.admin)),
      request(app).get("/api/v1/participants?name=MatrixScope").set(auth(fixture.admin)).set("X-Event-Id", fixture.eventA.eventId),
      request(app).get(`/api/v1/events/${fixture.eventA.eventId}/stations/${fixture.stationA.stationId}/queue`).set(auth(fixture.admin)),
      request(app).get(`/api/v1/events/${fixture.eventA.eventId}/reviews`).set(auth(fixture.admin)),
      request(app).get(`/api/v1/queues/events/${fixture.eventA.eventId}`).set(auth(fixture.admin)),
      request(app).get(`/api/v1/events/${fixture.eventA.eventId}/metrics`).set(auth(fixture.admin)),
      request(app).get(`/api/v1/events/reports/operations?eventId=${fixture.eventA.eventId}`).set(auth(fixture.admin)),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map(({ status }) => status)).toEqual([403, 403, 403, 403, 403, 200, 200]);
  });

  test("a completed event manager retains membership-only analytics access after duties complete", async () => {
    await prisma.staffAssignment.updateMany({
      where: { eventId: fixture.eventA.eventId },
      data: { status: "COMPLETED", assignmentStatus: "COMPLETED" },
    });
    await prisma.shift.update({ where: { shiftId: fixture.shiftA.shiftId }, data: { status: "COMPLETED" } });
    await prisma.event.update({ where: { eventId: fixture.eventA.eventId }, data: { status: "COMPLETED" } });

    const metrics = await request(app)
      .get(`/api/v1/events/${fixture.eventA.eventId}/metrics`)
      .set(auth(fixture.managerA));
    const report = await request(app)
      .get(`/api/v1/events/reports/operations?eventId=${fixture.eventA.eventId}`)
      .set(auth(fixture.managerA));
    const otherEvent = await request(app)
      .get(`/api/v1/events/${fixture.eventB.eventId}/metrics`)
      .set(auth(fixture.managerA));

    expect(metrics.status).toBe(200);
    expect(report.status).toBe(200);
    expect(otherEvent.status).toBe(403);
  });
});
