#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { hashToken } = require("../utils/crypto/qrToken");

const CONFIRMATION = "CREATE_SYNTHETIC_TEST_DATA";
const DEFAULT_COUNT = 500;
const BACKEND_ROOT = path.resolve(__dirname, "..");

function fail(message) {
  throw new Error(message);
}

function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    fail("DATABASE_URL must be an absolute PostgreSQL URL");
  }
}

function assertTestDatabase() {
  const name = databaseName(process.env.DATABASE_URL || "");
  if (!name.endsWith("_test")) fail("DATABASE_URL must select an isolated database ending in _test");
}

function participantCount() {
  const count = Number(process.env.PERF_PARTICIPANTS || DEFAULT_COUNT);
  if (!Number.isInteger(count) || count < 1 || count > 5000) fail("PERF_PARTICIPANTS must be an integer between 1 and 5000");
  return count;
}

function fixtureFile() {
  const file = process.env.PERF_FIXTURE_FILE || path.join(os.tmpdir(), "vsms-performance-fixture.json");
  if (!path.isAbsolute(file)) fail("PERF_FIXTURE_FILE must be an absolute path");
  const relative = path.relative(BACKEND_ROOT, file);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    fail("PERF_FIXTURE_FILE must be outside this repository");
  }
  if (fs.existsSync(file)) fail(`Refusing to overwrite existing fixture: ${file}`);
  return file;
}

async function main() {
  if (process.env.PERF_FIXTURE_CONFIRM !== CONFIRMATION) {
    fail(`Set PERF_FIXTURE_CONFIRM=${CONFIRMATION} before creating synthetic data`);
  }
  assertTestDatabase();
  const output = fixtureFile();
  const prisma = require("../prisma/prismaClient");
  const count = participantCount();
  const runId = crypto.randomUUID();
  const now = Date.now();
  const actor = await prisma.user.upsert({
    where: { email: "performance@vsms.test" },
    update: {
      fullName: "Synthetic Performance Operator",
      username: "performance-operator",
      status: "ACTIVE",
      approvalState: "APPROVED",
      accessState: "ENABLED",
      sysRole: "EVENT_MANAGER",
      deprovisionedAt: null,
    },
    create: {
      username: "performance-operator",
      fullName: "Synthetic Performance Operator",
      email: "performance@vsms.test",
      employeeNumber: "PERF-TEST-001",
      status: "ACTIVE",
      approvalState: "APPROVED",
      accessState: "ENABLED",
      sysRole: "EVENT_MANAGER",
    },
  });
  for (const roleName of ["REGISTRATION_OFFICER", "SCREENER", "EVENT_MANAGER"]) {
    const role = await prisma.role.upsert({ where: { roleName }, update: {}, create: { roleName } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: actor.id, roleId: role.id } },
      update: {},
      create: { userId: actor.id, roleId: role.id, assignedById: actor.id },
    });
  }
  const event = await prisma.event.create({
    data: {
      name: `Synthetic performance ${runId.slice(0, 8)}`,
      description: "Synthetic data only; created by the performance recovery kit.",
      venue: "Isolated test environment",
      timezone: "Asia/Singapore",
      startsAt: new Date(now - 60 * 60 * 1000),
      endsAt: new Date(now + 24 * 60 * 60 * 1000),
      capacity: count * 2,
      expectedAttendance: count * 2,
      status: "IN_PROGRESS",
      createdByUserId: actor.id,
      createIdempotencyKey: `performance-${runId}`,
      createPayloadHash: crypto.createHash("sha256").update(runId).digest("hex"),
    },
  });
  const membership = await prisma.eventMembership.create({
    data: { eventId: event.eventId, userId: actor.id, addedById: actor.id },
  });
  for (const role of ["REGISTRATION", "SCREENER", "EVENT_MANAGER"]) {
    await prisma.eventMembershipRole.create({ data: { membershipId: membership.id, role, assignedById: actor.id } });
  }
  const shift = await prisma.shift.create({
    data: {
      eventId: event.eventId,
      name: "Synthetic performance duty",
      startsAt: new Date(now - 30 * 60 * 1000),
      endsAt: new Date(now + 24 * 60 * 60 * 1000),
      requiredStaff: 1,
      status: "ACTIVE",
    },
  });
  const station = await prisma.station.create({
    data: { eventId: event.eventId, stationName: "Synthetic visual acuity", stationType: "VISUAL_ACUITY", stationOrder: 1 },
  });
  await prisma.staffAssignment.createMany({
    data: [
      { eventId: event.eventId, shiftId: shift.shiftId, userId: actor.id, assignedBy: actor.id, assignmentRole: "REGISTRATION", assignmentStatus: "CONFIRMED", status: "CONFIRMED" },
      { eventId: event.eventId, stationId: station.stationId, shiftId: shift.shiftId, userId: actor.id, assignedBy: actor.id, assignmentRole: "SCREENER", assignmentStatus: "CONFIRMED", status: "CONFIRMED" },
    ],
  });
  const registrationEvent = await prisma.event.create({
    data: {
      name: `Synthetic registration ${runId.slice(0, 8)}`,
      description: "Synthetic registration-write target for the same 500 participants.",
      venue: "Isolated test environment",
      timezone: "Asia/Singapore",
      startsAt: new Date(now - 60 * 60 * 1000),
      endsAt: new Date(now + 24 * 60 * 60 * 1000),
      capacity: count * 2,
      expectedAttendance: count,
      status: "IN_PROGRESS",
      createdByUserId: actor.id,
      createIdempotencyKey: `performance-registration-${runId}`,
      createPayloadHash: crypto.createHash("sha256").update(`registration-${runId}`).digest("hex"),
    },
  });
  const registrationMembership = await prisma.eventMembership.create({
    data: { eventId: registrationEvent.eventId, userId: actor.id, addedById: actor.id },
  });
  for (const role of ["REGISTRATION", "EVENT_MANAGER"]) {
    await prisma.eventMembershipRole.create({ data: { membershipId: registrationMembership.id, role, assignedById: actor.id } });
  }
  const registrationShift = await prisma.shift.create({
    data: {
      eventId: registrationEvent.eventId,
      name: "Synthetic registration duty",
      startsAt: new Date(now - 30 * 60 * 1000),
      endsAt: new Date(now + 24 * 60 * 60 * 1000),
      requiredStaff: 1,
      status: "ACTIVE",
    },
  });
  const registrationStation = await prisma.station.create({
    data: { eventId: registrationEvent.eventId, stationName: "Synthetic registration visual acuity", stationType: "VISUAL_ACUITY", stationOrder: 1 },
  });
  await prisma.staffAssignment.createMany({
    data: [
      { eventId: registrationEvent.eventId, shiftId: registrationShift.shiftId, userId: actor.id, assignedBy: actor.id, assignmentRole: "REGISTRATION", assignmentStatus: "CONFIRMED", status: "CONFIRMED" },
      { eventId: registrationEvent.eventId, stationId: registrationStation.stationId, shiftId: registrationShift.shiftId, userId: actor.id, assignedBy: actor.id, assignmentRole: "SCREENER", assignmentStatus: "CONFIRMED", status: "CONFIRMED" },
    ],
  });
  const consentText = "Synthetic performance-test consent; no real participant data.";
  const consentForm = await prisma.consentFormVersion.upsert({
    where: { formCode_versionNumber: { formCode: "PERF-TEST", versionNumber: "1" } },
    update: { isActive: true, effectiveTo: null },
    create: {
      formCode: "PERF-TEST",
      versionNumber: "1",
      title: "Synthetic performance consent",
      contentText: consentText,
      contentHash: crypto.createHash("sha256").update(consentText).digest("hex"),
      documentObjectKey: "synthetic/performance/consent-v1",
      effectiveFrom: new Date(now - 24 * 60 * 60 * 1000),
      isActive: true,
      createdById: actor.id,
    },
  });
  const participantIds = Array.from({ length: count }, () => crypto.randomUUID());
  await prisma.$transaction(async (tx) => {
    await tx.participant.createMany({
      data: participantIds.map((id, index) => ({
        id,
        participantReference: `PERF-${runId.slice(0, 8)}-${String(index + 1).padStart(4, "0")}`,
        firstName: "Synthetic",
        lastName: `Participant ${index + 1}`,
        dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
        gender: "U",
        contactNumber: `+658${String(index).padStart(7, "0")}`,
        emergencyContact: `+659${String(index).padStart(7, "0")}`,
        consentGiven: true,
        createdById: actor.id,
        updatedById: actor.id,
        onboardingEventId: event.eventId,
      })),
    });
    await tx.participantEmergencyContact.createMany({
      data: participantIds.map((participantId, index) => ({
        participantId,
        contactName: `Synthetic Contact ${index + 1}`,
        relationship: "Test contact",
        phoneNumber: `+659${String(index).padStart(7, "0")}`,
        isPrimary: true,
        status: "ACTIVE",
        createdById: actor.id,
        updatedById: actor.id,
      })),
    });
    await tx.participantConsent.createMany({
      data: participantIds.flatMap((participantId) => [event.eventId, registrationEvent.eventId].map((eventId) => ({
        participantId,
        eventId,
        consentFormVersionId: consentForm.id,
        consentStatus: "ACCEPTED",
        signerType: "PARTICIPANT",
        signerName: "Synthetic Participant",
        recordedById: actor.id,
        signedAt: new Date(),
        decisionAt: new Date(),
      }))),
    });
    await tx.participantEventIntake.createMany({
      data: participantIds.map((participantId) => ({
        participantId,
        eventId: registrationEvent.eventId,
        attachedById: actor.id,
        reason: "PERFORMANCE_TEST",
      })),
    });
  });
  const pollRegistrations = participantIds.map((participantId, index) => ({
    registrationId: crypto.randomUUID(),
    participantId,
    eventId: event.eventId,
    registeredBy: actor.id,
    registrationStatus: "CHECKED_IN",
    participantDisplayName: `Synthetic Poll Participant ${index + 1}`,
    queueNumber: index + 1,
    idempotencyKey: `performance-poll-${runId}-${index + 1}`,
    checkedIn: true,
    checkedInAt: new Date(),
  }));
  const pollTokens = pollRegistrations.map(() => crypto.randomBytes(32).toString("hex"));
  await prisma.$transaction(async (tx) => {
    await tx.eventRegistration.createMany({ data: pollRegistrations });
    await tx.registrationRouteStep.createMany({
      data: pollRegistrations.map(({ registrationId }) => ({ registrationId, stationId: station.stationId, position: 1 })),
    });
    await tx.queueEntry.createMany({
      data: pollRegistrations.map(({ registrationId, queueNumber }) => ({
        registrationId,
        stationId: station.stationId,
        queueNumber,
        status: "WAITING",
      })),
    });
    await tx.qRCodePass.createMany({
      data: pollRegistrations.map(({ registrationId }, index) => ({
        id: crypto.randomUUID(),
        registrationId,
        tokenHash: hashToken(pollTokens[index]),
        tokenCiphertext: null,
        tokenEncryptionVersion: 2,
        expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        isActive: true,
      })),
    });
  });
  fs.writeFileSync(output, `${JSON.stringify({
    target: databaseName(process.env.DATABASE_URL),
    eventId: event.eventId,
    registrationEventId: registrationEvent.eventId,
    stationId: station.stationId,
    actorId: actor.id,
    participantIds,
    pollRegistrationIds: pollRegistrations.map(({ registrationId }) => registrationId),
    pollTokens,
  }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Synthetic fixture written to ${output} for ${count} participants.\n`);
  await prisma.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`Fixture preparation refused: ${error.message}\n`);
  process.exitCode = 1;
});
