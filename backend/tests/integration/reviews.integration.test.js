const { test, describe, before, after } = require("node:test");
const { expect } = require("expect");
const crypto = require("crypto");
const request = require("supertest");
require("dotenv").config();

let app;
let prisma;
let helpers;
let eventId;
let zeroStationEventId;
let reviewerToken;
let screenerToken;
let stationByType;
const registrations = {};
const decisionSignatures = new Map();

const signatureDataUrl = () => {
  const buffer = Buffer.alloc(128);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return `data:image/png;base64,${buffer.toString("base64")}`;
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const eyeHealthObservations = (overrides = {}) => ({
  cataractRisk: "NOT_ASSESSED",
  glaucomaRisk: "NONE",
  symptomsNoted: false,
  observations: "No anterior-segment or media concern noted on review.",
  ...overrides,
});

const createRegistration = async (label, queueNumber, resultFlags) => {
  const participant = await prisma.participant.create({
    data: {
      nric: `TEST-${crypto.randomUUID()}`,
      participantReference: `REV-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      nricMasked: "••••123A",
      firstName: label,
      lastName: "Participant",
      dateOfBirth: new Date("1970-01-01T00:00:00.000Z"),
      gender: "F",
      contactNumber: "+65 6000 1000",
      createdById: testUsers.manager.id,
      updatedById: testUsers.manager.id,
      onboardingEventId: eventId,
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
      idempotencyKey: `review-${label.toLowerCase()}-${crypto.randomUUID()}`,
      checkedIn: true,
    },
  });
  const resultDates = new Map();
  for (const [stationType, overallFlag] of Object.entries(resultFlags)) {
    const station = stationByType.get(stationType);
    const result = await prisma.screeningResult.create({
      data: {
        registrationId: registration.registrationId,
        stationId: station.stationId,
        recordedByUserId: testUsers.screener.id,
        screeningType: stationType,
        resultData: stationType === "VISUAL_ACUITY"
          ? { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 6 }, os: { kind: "FRACTION", denominator: 6 }, withUsualDistanceGlasses: false, screenerComment: "Participant needed extra time." }
          : { finding: `${stationType} test result` },
        overallFlag,
        isFlagged: overallFlag !== "NORMAL",
        flagSummary: overallFlag === "NORMAL" ? null : `${overallFlag} recommendation`,
        ruleVersion: "1.0",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    resultDates.set(station.stationId, result.updatedAt);
  }
  await prisma.registrationRouteStep.createMany({
    data: [...stationByType.values()].map((station, index) => ({
      registrationId: registration.registrationId,
      stationId: station.stationId,
      position: index + 1,
      completedAt: resultDates.get(station.stationId) || null,
    })),
  });
  const current = [...stationByType.values()].find((station) => !resultDates.has(station.stationId));
  if (current) {
    await prisma.queueEntry.create({
      data: { registrationId: registration.registrationId, stationId: current.stationId, queueNumber },
    });
  }
  registrations[label] = registration.registrationId;
  return registration;
};

const allNormal = () => Object.fromEntries(["VISUAL_ACUITY", "REFRACTION", "COLOUR_VISION", "EYE_HEALTH"].map((type) => [type, "NORMAL"]));
const testUsers = {};

const uploadDecisionSignature = async (registrationId, token = reviewerToken) => {
  const response = await request(app).post("/api/v1/signatures").set(auth(token)).send({
    eventId,
    targetId: registrationId,
    purpose: "REVIEW_DECISION",
    dataUrl: signatureDataUrl(),
  });
  expect(response.status).toBe(201);
  return response.body;
};

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOCAL_HTTPS = "false";
  helpers = require("../helpers");
  app = require("../../app");
  prisma = helpers.prisma;

  for (const [label, role] of Object.entries({
    reviewer: "REVIEWER",
    admin: "ADMINISTRATOR",
    manager: "EVENT_MANAGER",
    screener: "SCREENER",
    inactive: "REVIEWER",
    inactiveShift: "REVIEWER",
  })) {
    testUsers[label] = await helpers.ensureTestUser(role, `review-${label}`);
  }
  reviewerToken = helpers.accessTokenFor(testUsers.reviewer);
  screenerToken = helpers.accessTokenFor(testUsers.screener);

  const startsAt = new Date(Date.now() - 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const event = await prisma.event.create({
    data: { name: "Review integration", venue: "Test hall", timezone: "Asia/Singapore", startsAt, endsAt, capacity: 50, status: "IN_PROGRESS", createdByUserId: testUsers.manager.id },
  });
  eventId = event.eventId;
  const addMembership = (scopedEventId, member, roles) => prisma.eventMembership.create({
    data: {
      eventId: scopedEventId,
      userId: member.id,
      addedById: testUsers.manager.id,
      roles: { create: roles.map((role) => ({ role, assignedById: testUsers.manager.id })) },
    },
  });
  await addMembership(eventId, testUsers.manager, ["EVENT_MANAGER"]);
  await addMembership(eventId, testUsers.reviewer, ["REVIEWER"]);
  await addMembership(eventId, testUsers.screener, ["SCREENER"]);
  await addMembership(eventId, testUsers.inactive, ["REVIEWER"]);
  await addMembership(eventId, testUsers.inactiveShift, ["REVIEWER"]);
  const activeShift = await prisma.shift.create({ data: { eventId, name: "Active review", startsAt, endsAt, status: "ACTIVE" } });
  const inactiveShift = await prisma.shift.create({ data: { eventId, name: "Inactive review", startsAt, endsAt, status: "PLANNED" } });
  const stations = [];
  for (const [index, stationType] of ["VISUAL_ACUITY", "REFRACTION", "COLOUR_VISION", "EYE_HEALTH"].entries()) {
    const fieldSchemaSnapshot = stationType === "VISUAL_ACUITY" ? [
      { key: "screenerComment", label: "Accommodation needed?", type: "text", required: false },
      { key: "chartDistanceMetres", label: "Testing distance", type: "select", required: true, options: ["3", "6"] },
      { key: "od", label: "Dominant eye reading", type: "va-eye", required: true },
      { key: "os", label: "Other eye reading", type: "va-eye", required: true },
      { key: "withUsualDistanceGlasses", label: "Glasses worn", type: "select", required: true, options: ["yes", "no", "unknown"] },
    ] : null;
    stations.push(await prisma.station.create({
      data: { eventId, stationName: stationType, stationType, stationOrder: index + 1, isActive: true, fieldSchemaSnapshot },
    }));
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
  await createRegistration("Urgent", 30, { VISUAL_ACUITY: "URGENT" });
  await createRegistration("Incomplete", 40, { VISUAL_ACUITY: "REVIEW" });
  await createRegistration("Stale", 50, allNormal());
  await createRegistration("Concurrent", 60, allNormal());
  await createRegistration("ReplayTarget", 70, allNormal());

  const zeroEvent = await prisma.event.create({
    data: { name: "Zero stations", venue: "Test hall", timezone: "Asia/Singapore", startsAt, endsAt, capacity: 5, status: "IN_PROGRESS", createdByUserId: testUsers.manager.id },
  });
  zeroStationEventId = zeroEvent.eventId;
  await addMembership(zeroStationEventId, testUsers.manager, ["EVENT_MANAGER"]);
  await addMembership(zeroStationEventId, testUsers.reviewer, ["REVIEWER"]);
  const zeroShift = await prisma.shift.create({ data: { eventId: zeroStationEventId, name: "Review", startsAt, endsAt, status: "ACTIVE" } });
  await prisma.staffAssignment.create({ data: { eventId: zeroStationEventId, userId: testUsers.reviewer.id, assignedBy: testUsers.manager.id, shiftId: zeroShift.shiftId, assignmentRole: "REVIEWER", status: "CONFIRMED", assignmentStatus: "CONFIRMED" } });
});

after(async () => prisma?.$disconnect());

describe("clinical review API", () => {
  test("assigned reviewer lists only complete or urgent registrations and inspects a redacted detail", async () => {
    const queue = await request(app).get(`/api/events/${eventId}/reviews`).set(auth(reviewerToken));
    expect(queue.status).toBe(200);
    expect(queue.body.queue.map((item) => item.registrationId)).toEqual(expect.arrayContaining([registrations.Normal, registrations.Flagged, registrations.Urgent]));
    expect(queue.body.queue.map((item) => item.registrationId)).not.toContain(registrations.Incomplete);

    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Normal}`).set(auth(reviewerToken));
    expect(detail.status).toBe(200);
    const visualAcuity = detail.body.stations.find((station) => station.stationType === "VISUAL_ACUITY");
    expect(visualAcuity.fieldSchemaSnapshot).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "chartDistanceMetres", label: expect.any(String) }),
    ]));
    expect(detail.body.participant.maskedNric).toMatch(/^••••/);
    expect(JSON.stringify(detail.body)).not.toContain("TEST-");
    expect(JSON.stringify(detail.body)).not.toContain(testUsers.reviewer.email);
    const visualAcuity = detail.body.stations.find((station) => station.stationType === "VISUAL_ACUITY");
    expect(visualAcuity.fieldSchemaSnapshot.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "screenerComment", label: "Accommodation needed?" },
      { key: "chartDistanceMetres", label: "Testing distance" },
      { key: "od", label: "Dominant eye reading" },
      { key: "os", label: "Other eye reading" },
      { key: "withUsualDistanceGlasses", label: "Glasses worn" },
    ]);
    expect(visualAcuity.result.resultData.screenerComment).toBe("Participant needed extra time.");
  });

  test("admin, manager, screener, inactive assignment, and inactive shift receive no bypass", async () => {
    for (const label of ["admin", "manager", "screener", "inactive", "inactiveShift"]) {
      const response = await request(app).get(`/api/events/${eventId}/reviews`).set(auth(helpers.accessTokenFor(testUsers[label])));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe(["inactive", "inactiveShift"].includes(label)
        ? "CURRENT_DUTY_REQUIRED"
        : "EVENT_ROLE_REQUIRED");
    }
  });

  test("zero active stations produce an empty queue", async () => {
    const response = await request(app).get(`/api/events/${zeroStationEventId}/reviews`).set(auth(reviewerToken));
    expect(response.status).toBe(200);
    expect(response.body.queue).toEqual([]);
  });

  test("complete writes one review, completion status, no referral, and one safe audit", async () => {
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Normal}`).set(auth(reviewerToken));
    const signature = await uploadDecisionSignature(registrations.Normal);
    decisionSignatures.set(registrations.Normal, signature);
    const response = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Normal}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Screening is within expected limits.", eyeHealthObservations: eyeHealthObservations(), ...signature,
    });
    expect(response.status).toBe(201);
    expect(await prisma.review.count({ where: { registrationId: registrations.Normal } })).toBe(1);
    expect(await prisma.referral.count({ where: { registrationId: registrations.Normal } })).toBe(0);
    expect((await prisma.eventRegistration.findUnique({ where: { registrationId: registrations.Normal } })).registrationStatus).toBe("COMPLETED");
    const audits = (await prisma.auditLog.findMany({ where: { userId: testUsers.reviewer.id, action: "CLINICAL_REVIEW_RECORDED" } })).filter((audit) => audit.details.registrationId === registrations.Normal);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain("TEST-");
    expect(JSON.stringify(audits)).not.toContain("Screening is within expected limits");
    expect(audits[0].details.signaturePurpose).toBe("REVIEW_DECISION");
    expect(audits[0].details.eyeHealthRecorded).toBe(true);
    expect(audits[0].details.signatureSha256).toBe("[REDACTED]");
    const review = await prisma.review.findFirstOrThrow({ where: { registrationId: registrations.Normal } });
    expect(review.signatureSignerUserId).toBe(testUsers.reviewer.id);
    expect(review.signatureObjectKey).toBe(signature.signatureObjectKey);
    expect(review.signedPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(review.signedAt).toBeInstanceOf(Date);
    expect(review.eyeHealthObservations).toMatchObject({
      cataractRisk: "NOT_ASSESSED",
      glaucomaRisk: "NONE",
      symptomsNoted: false,
      observations: "No anterior-segment or media concern noted on review.",
    });
    expect((await prisma.signatureArtifact.findUnique({ where: { signatureObjectKey: signature.signatureObjectKey } })).consumedAt).toBeInstanceOf(Date);
  });

  for (const [label, outcome, urgency] of [
    ["Flagged", "REFER", "PRIORITY"],
    ["Urgent", "URGENT_ESCALATION", undefined],
  ]) {
    test(`${label} referral decision atomically writes the review, draft referral, completion, and both audits`, async () => {
      const registrationId = registrations[label];
      const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrationId}`).set(auth(reviewerToken));
      const signature = await uploadDecisionSignature(registrationId);
      decisionSignatures.set(registrationId, signature);
      const response = await request(app).post(`/api/events/${eventId}/reviews/${registrationId}/decision`).set(auth(reviewerToken)).send({
        outcome,
        ...(urgency ? { urgency } : {}),
        contextVersion: detail.body.contextVersion,
        confirmed: true,
        clinicalSummary: "Findings require a documented referral.",
        eyeHealthObservations: eyeHealthObservations({ cataractRisk: "SUSPECTED", symptomsNoted: true, symptomSummary: "Blurred near vision" }),
        referral: { destinationName: "Test Eye Centre", reason: "Specialist assessment is recommended." },
        ...signature,
      });
      expect(response.status).toBe(201);
      expect(response.body.referral.status).toBe("DRAFT");
      expect(await prisma.review.count({ where: { registrationId } })).toBe(1);
      expect(await prisma.referral.count({ where: { registrationId, status: "DRAFT" } })).toBe(1);
      expect((await prisma.eventRegistration.findUnique({ where: { registrationId } })).registrationStatus).toBe("COMPLETED");
      if (label === "Urgent") {
        expect(await prisma.queueEntry.count({ where: { registrationId, status: { in: ["WAITING", "CALLED", "IN_PROGRESS"] } } })).toBe(0);
        expect(await prisma.queueEntry.count({ where: { registrationId, status: "CANCELLED" } })).toBe(1);
        expect(await prisma.registrationRouteStep.count({ where: { registrationId, completedAt: null } })).toBe(3);
      }
      const audits = (await prisma.auditLog.findMany({ where: { userId: testUsers.reviewer.id } })).filter((audit) => audit.details?.registrationId === registrationId);
      expect(audits.map((audit) => audit.action).sort()).toEqual(["CLINICAL_REVIEW_RECORDED", "REFERRAL_DRAFT_CREATED"]);
    });
  }

  test("duplicate and concurrent decisions return 409 without duplicate records", async () => {
    const duplicate = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Normal}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: "a".repeat(64), confirmed: true, clinicalSummary: "Duplicate decision attempt.", eyeHealthObservations: eyeHealthObservations(), ...decisionSignatures.get(registrations.Normal),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("REVIEW_ALREADY_RECORDED");

    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Concurrent}`).set(auth(reviewerToken));
    const signatures = await Promise.all([uploadDecisionSignature(registrations.Concurrent), uploadDecisionSignature(registrations.Concurrent)]);
    const decide = (signature) => request(app).post(`/api/events/${eventId}/reviews/${registrations.Concurrent}/decision`).set(auth(reviewerToken)).send({
      outcome: "MONITOR", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Monitor and repeat screening if symptoms change.", ...signature,
    });
    const responses = await Promise.all(signatures.map(decide));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.review.count({ where: { registrationId: registrations.Concurrent } })).toBe(1);
    const audit = (await prisma.auditLog.findMany({ where: { userId: testUsers.reviewer.id, action: "CLINICAL_REVIEW_RECORDED" } }))
      .find((entry) => entry.details.registrationId === registrations.Concurrent);
    expect(audit.details.eyeHealthRecorded).toBe(false);
  });

  test("stale context returns 409 without a decision", async () => {
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Stale}`).set(auth(reviewerToken));
    const signature = await uploadDecisionSignature(registrations.Stale);
    await prisma.screeningResult.update({
      where: { registrationId_stationId: { registrationId: registrations.Stale, stationId: stationByType.get("REFRACTION").stationId } },
      data: { resultData: { changed: true } },
    });
    const response = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Stale}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "This context is deliberately stale.", eyeHealthObservations: eyeHealthObservations(), ...signature,
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SCREENING_RESULTS_CHANGED");
    expect(await prisma.review.count({ where: { registrationId: registrations.Stale } })).toBe(0);
    expect((await prisma.signatureArtifact.findUnique({ where: { signatureObjectKey: signature.signatureObjectKey } })).consumedAt).toBeNull();
  });

  test("strict validation requires referral fields only for referral decisions", async () => {
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.Stale}`).set(auth(reviewerToken));
    const signature = await uploadDecisionSignature(registrations.Stale);
    const extra = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Stale}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Valid summary, invalid extra referral.", eyeHealthObservations: eyeHealthObservations(), referral: { destinationName: "Clinic", reason: "Not permitted here" }, ...signature,
    });
    const missing = await request(app).post(`/api/events/${eventId}/reviews/${registrations.Stale}/decision`).set(auth(reviewerToken)).send({
      outcome: "REFER", urgency: "ROUTINE", contextVersion: detail.body.contextVersion, confirmed: true, clinicalSummary: "Referral fields are intentionally missing.", eyeHealthObservations: eyeHealthObservations(), ...signature,
    });
    expect(extra.status).toBe(422);
    expect(missing.status).toBe(422);
    expect(extra.body.code).toBe("VALIDATION_ERROR");
  });

  test("a signature cannot be replayed across decision targets", async () => {
    const sourceSignature = await uploadDecisionSignature(registrations.Stale);
    const detail = await request(app).get(`/api/events/${eventId}/reviews/${registrations.ReplayTarget}`).set(auth(reviewerToken));
    const response = await request(app).post(`/api/events/${eventId}/reviews/${registrations.ReplayTarget}/decision`).set(auth(reviewerToken)).send({
      outcome: "COMPLETE",
      contextVersion: detail.body.contextVersion,
      confirmed: true,
      clinicalSummary: "This signature belongs to a different registration.",
      eyeHealthObservations: eyeHealthObservations(),
      ...sourceSignature,
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SIGNATURE_ALREADY_USED");
    expect(await prisma.review.count({ where: { registrationId: registrations.ReplayTarget } })).toBe(0);
  });

  test("screening results cannot change after review completion", async () => {
    const station = stationByType.get("VISUAL_ACUITY");
    const response = await request(app).post(`/api/events/${eventId}/stations/${station.stationId}/visual-acuity`).set(auth(screenerToken)).send({
      registrationId: registrations.Normal,
      idempotencyKey: crypto.randomUUID(),
      acknowledged: true,
      resultData: { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 6 }, os: { kind: "FRACTION", denominator: 6 }, withUsualDistanceGlasses: false },
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("REGISTRATION_NOT_SCREENABLE");
  });
});
