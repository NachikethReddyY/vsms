const crypto = require("crypto");
const request = require("supertest");
require("dotenv").config();

let app;
let prisma;
let signAccessToken;
let eventId;
let zeroStationEventId;
let reviewerToken;
let adminToken;
let stationByType;
const registrations = {};

const userInput = (label, sysRole = "STAFF") => ({
  id: crypto.randomUUID(),
  username: `review-${label}-${crypto.randomUUID().slice(0, 6)}`,
  fullName: `Review ${label}`,
  email: `${crypto.randomUUID()}@reviews.tests.vsms.local`,
  employeeNumber: `R${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`,
  sysRole,
  status: "ACTIVE",
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const createRegistration = async (label, queueNumber, resultFlags) => {
  const participant = await prisma.participant.create({
    data: {
      participantReference: `REVIEW-${crypto.randomUUID().slice(0, 20)}`,
      nric: `TEST-${crypto.randomUUID()}`,
      nricMasked: "T****123A",
      firstName: label,
      lastName: "Participant",
      dateOfBirth: new Date("1970-01-01T00:00:00.000Z"),
      gender: "F",
      contactNumber: "+65 6000 1000",
      emergencyContact: "+65 6000 1001",
      consentGiven: true,
      createdById: testUsers.manager.id,
      updatedById: testUsers.manager.id,
    },
  });
  const registration = await prisma.eventRegistration.create({
    data: {
      eventId,
      participantId: participant.id,
      registeredBy: testUsers.manager.id,
      registrationStatus: "CHECKED_IN",
      participantDisplayName: `${label} Participant`,
      queueNumber,
      checkedIn: true,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  for (const [stationType, overallFlag] of Object.entries(resultFlags)) {
    const station = stationByType.get(stationType);
    await prisma.screeningResult.create({
      data: {
        registrationId: registration.registrationId,
        stationId: station.stationId,
        recordedByUserId: testUsers.screener.id,
        screeningType: stationType,
        resultData: stationType === "VISUAL_ACUITY"
          ? { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 6 }, os: { kind: "FRACTION", denominator: 6 }, withUsualDistanceGlasses: false }
          : { finding: `${stationType} test result` },
        overallFlag,
        isFlagged: overallFlag !== "NORMAL",
        flagSummary: overallFlag === "NORMAL" ? null : `${overallFlag} recommendation`,
        ruleVersion: "1.0",
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }
  registrations[label] = registration.registrationId;
  return registration;
};

const allNormal = () => Object.fromEntries(["VISUAL_ACUITY", "REFRACTION", "COLOUR_VISION", "EYE_HEALTH"].map((type) => [type, "NORMAL"]));
const testUsers = {};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOCAL_HTTPS = "false";
  process.env.JWT_ACCESS_SECRET = "review-tests-access-secret-with-at-least-thirty-two-characters";
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!databaseUrl.pathname.endsWith("_test")) databaseUrl.pathname = `${databaseUrl.pathname}_test`;
  process.env.DATABASE_URL = databaseUrl.toString();

  app = require("../app");
  prisma = require("../prisma/prismaClient");
  ({ signAccessToken } = require("../utils/tokens"));

  for (const [label, role] of Object.entries({ reviewer: "STAFF", admin: "ADMIN", manager: "EVENT_MANAGER", screener: "STAFF", inactive: "STAFF", inactiveShift: "STAFF" })) {
    testUsers[label] = await prisma.user.create({ data: userInput(label, role) });
    const roleName = role === "ADMIN" ? "ADMINISTRATOR" : role === "EVENT_MANAGER" ? "EVENT_MANAGER" : "SCREENER";
    const applicationRole = await prisma.role.upsert({ where: { roleName }, update: {}, create: { roleName } });
    await prisma.userRole.create({ data: { userId: testUsers[label].id, roleId: applicationRole.id } });
  }
  reviewerToken = signAccessToken(testUsers.reviewer);
  adminToken = signAccessToken(testUsers.admin);

  const startsAt = new Date("2035-01-01T00:00:00.000Z");
  const endsAt = new Date("2035-01-01T08:00:00.000Z");
  const event = await prisma.event.create({
    data: { name: "Review integration", venue: "Test hall", timezone: "Asia/Singapore", startsAt, endsAt, capacity: 50, status: "IN_PROGRESS", createdByUserId: testUsers.manager.id },
  });
  eventId = event.eventId;
  const activeShift = await prisma.shift.create({ data: { eventId, name: "Active review", startsAt, endsAt, status: "ACTIVE" } });
  const inactiveShift = await prisma.shift.create({ data: { eventId, name: "Inactive review", startsAt, endsAt, status: "PLANNED" } });
  const stations = [];
  for (const [index, stationType] of ["VISUAL_ACUITY", "REFRACTION", "COLOUR_VISION", "EYE_HEALTH"].entries()) {
    stations.push(await prisma.station.create({ data: { eventId, stationName: stationType, stationType, stationOrder: index + 1, isActive: true } }));
  }
  stationByType = new Map(stations.map((station) => [station.stationType, station]));

  const assignment = (userId, assignmentRole, shiftId, status = "CONFIRMED", stationId = null) => prisma.staffAssignment.create({
    data: { eventId, userId, assignedBy: testUsers.manager.id, shiftId, stationId, assignmentRole, status, assignmentStatus: status },
  });
  await assignment(testUsers.reviewer.id, "REVIEWER", activeShift.shiftId);
  await assignment(testUsers.screener.id, "SCREENER", activeShift.shiftId, "CONFIRMED", stations[0].stationId);
  await assignment(testUsers.inactive.id, "REVIEWER", activeShift.shiftId, "CANCELLED");
  await assignment(testUsers.inactiveShift.id, "REVIEWER", inactiveShift.shiftId);

  await createRegistration("Normal", 10, allNormal());
  await createRegistration("Flagged", 20, { ...allNormal(), EYE_HEALTH: "REFER" });
  await createRegistration("Urgent", 30, { EYE_HEALTH: "URGENT" });
  await createRegistration("Incomplete", 40, { VISUAL_ACUITY: "REVIEW" });
  await createRegistration("Stale", 50, allNormal());
  await createRegistration("Concurrent", 60, allNormal());

  const zeroEvent = await prisma.event.create({
    data: { name: "Zero stations", venue: "Test hall", timezone: "Asia/Singapore", startsAt, endsAt, capacity: 5, status: "IN_PROGRESS", createdByUserId: testUsers.manager.id },
  });
  zeroStationEventId = zeroEvent.eventId;
  const zeroShift = await prisma.shift.create({ data: { eventId: zeroStationEventId, name: "Review", startsAt, endsAt, status: "ACTIVE" } });
  await prisma.staffAssignment.create({ data: { eventId: zeroStationEventId, userId: testUsers.reviewer.id, assignedBy: testUsers.manager.id, shiftId: zeroShift.shiftId, assignmentRole: "REVIEWER", status: "CONFIRMED", assignmentStatus: "CONFIRMED" } });
});

afterAll(async () => prisma?.$disconnect());

describe("clinical review API", () => {
  test("assigned reviewer lists only complete or urgent registrations and inspects a redacted detail", async () => {
    const queue = await request(app).get(`/api/events/${eventId}/reviews`).set(auth(reviewerToken));
    expect(queue.status).toBe(200);
    expect(queue.body.queue.map((item) => item.registrationId)).toEqual(expect.arrayContaining([registrations.Normal, registrations.Flagged, registrations.Urgent]));
    expect(queue.body.queue.map((item) => item.registrationId)).not.toContain(registrations.Incomplete);

    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Normal}`).set(auth(reviewerToken));
    expect(detail.status).toBe(200);
    expect(detail.body.participant.maskedNric).toMatch(/^••••/);
    expect(JSON.stringify(detail.body)).not.toContain("TEST-");
    expect(JSON.stringify(detail.body)).not.toContain(testUsers.reviewer.email);
  });

  test("admin, manager, screener, inactive assignment, and inactive shift receive no bypass", async () => {
    for (const label of ["admin", "manager", "screener", "inactive", "inactiveShift"]) {
      const response = await request(app).get(`/api/events/${eventId}/reviews`).set(auth(signAccessToken(testUsers[label])));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("REVIEWER_ASSIGNMENT_REQUIRED");
    }
  });

  test("zero active stations produce an empty queue", async () => {
    const response = await request(app).get(`/api/events/${zeroStationEventId}/reviews`).set(auth(reviewerToken));
    expect(response.status).toBe(200);
    expect(response.body.queue).toEqual([]);
  });

  test("complete writes one review, completion status, no referral, and one safe audit", async () => {
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Normal}`).set(auth(reviewerToken));
    const response = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Normal}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Screening is within expected limits.",
    });
    expect(response.status).toBe(201);
    expect(await prisma.review.count({ where: { registrationId: registrations.Normal } })).toBe(1);
    expect(await prisma.referral.count({ where: { registrationId: registrations.Normal } })).toBe(0);
    expect((await prisma.eventRegistration.findUnique({ where: { registrationId: registrations.Normal } })).registrationStatus).toBe("COMPLETED");
    const audits = (await prisma.auditLog.findMany({ where: { userId: testUsers.reviewer.id, action: "CLINICAL_REVIEW_RECORDED" } })).filter((audit) => audit.details.registrationId === registrations.Normal);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain("TEST-");
    expect(JSON.stringify(audits)).not.toContain("Screening is within expected limits");
  });

  test.each([
    ["Flagged", "REFER", "PRIORITY"],
    ["Urgent", "URGENT_ESCALATION", undefined],
  ])("%s referral decision atomically writes the review, draft referral, completion, and both audits", async (label, outcome, urgency) => {
    const registrationId = registrations[label];
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrationId}`).set(auth(reviewerToken));
    const response = await request(app).post(`/api/events/${eventId}/reviews/${registrationId}/decision`).set(auth(reviewerToken)).send({
      outcome,
      ...(urgency ? { urgency } : {}),
      contextVersion: detail.body.contextVersion,
      confirmed: true,
      clinicalSummary: "Findings require a documented referral.",
      referral: { destinationName: "Test Eye Centre", reason: "Specialist assessment is recommended." },
    });
    expect(response.status).toBe(201);
    expect(response.body.referral.status).toBe("DRAFT");
    expect(await prisma.review.count({ where: { registrationId } })).toBe(1);
    expect(await prisma.referral.count({ where: { registrationId, status: "DRAFT" } })).toBe(1);
    expect((await prisma.eventRegistration.findUnique({ where: { registrationId } })).registrationStatus).toBe("COMPLETED");
    const audits = (await prisma.auditLog.findMany({ where: { userId: testUsers.reviewer.id } })).filter((audit) => audit.details?.registrationId === registrationId);
    expect(audits.map((audit) => audit.action).sort()).toEqual(["CLINICAL_REVIEW_RECORDED", "REFERRAL_DRAFT_CREATED"]);
  });

  test("duplicate and concurrent decisions return 409 without duplicate records", async () => {
    const duplicate = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Normal}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: "a".repeat(64), confirmed: true, clinicalSummary: "Duplicate decision attempt.",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("REVIEW_ALREADY_RECORDED");

    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Concurrent}`).set(auth(reviewerToken));
    const decide = () => request(app).post(`/api/events/${eventId}/reviews/${registrations.Concurrent}/decision`).set(auth(reviewerToken)).send({
      outcome: "MONITOR", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Monitor and repeat screening if symptoms change.",
    });
    const responses = await Promise.all([decide(), decide()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.review.count({ where: { registrationId: registrations.Concurrent } })).toBe(1);
  });

  test("stale context returns 409 without a decision", async () => {
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Stale}`).set(auth(reviewerToken));
    await prisma.screeningResult.update({
      where: { registrationId_stationId: { registrationId: registrations.Stale, stationId: stationByType.get("REFRACTION").stationId } },
      data: { resultData: { changed: true } },
    });
    const response = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Stale}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "This context is deliberately stale.",
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SCREENING_RESULTS_CHANGED");
    expect(await prisma.review.count({ where: { registrationId: registrations.Stale } })).toBe(0);
  });

  test("strict validation requires referral fields only for referral decisions", async () => {
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Stale}`).set(auth(reviewerToken));
    const extra = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Stale}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Valid summary, invalid extra referral.", referral: { destinationName: "Clinic", reason: "Not permitted here" },
    });
    const missing = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Stale}/decision`).set(auth(reviewerToken)).send({
      outcome: "REFER", urgency: "ROUTINE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Referral fields are intentionally missing.",
    });
    expect(extra.status).toBe(422);
    expect(missing.status).toBe(422);
    expect(extra.body.code).toBe("VALIDATION_ERROR");
  });

  test("screening results cannot change after review completion", async () => {
    const station = stationByType.get("VISUAL_ACUITY");
    const response = await request(app).post(`/api/events/${eventId}/stations/${station.stationId}/visual-acuity`).set(auth(adminToken)).send({
      registrationId: registrations.Normal,
      idempotencyKey: crypto.randomUUID(),
      acknowledged: true,
      resultData: { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 6 }, os: { kind: "FRACTION", denominator: 6 }, withUsualDistanceGlasses: false },
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("REGISTRATION_NOT_SCREENABLE");
  });
});
