const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const participantService = require("../../services/participantService");

function replace(t, target, key, value) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

function request(participantId, eventId, userId) {
  return {
    params: { participantId },
    body: { firstName: "John", lastName: "Tan", dateOfBirth: "2002-03-12", contactNumber: "81234567" },
    registrationEventId: eventId,
    auth: { userId, permissions: ["participants:cross-event-reuse"] },
    context: {},
  };
}

test("a previous-event identity match is audited before the officer can reuse it", async (t) => {
  const eventId = crypto.randomUUID();
  const priorEventId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  let audit;
  replace(t, prisma.participant, "findMany", async () => [{
    id: participantId, participantReference: "VSMS-2026-000001", firstName: "John", lastName: "Tan",
    dateOfBirth: new Date("2002-03-12T00:00:00.000Z"), contactNumber: "81234567", preferredLanguage: "English",
    eventRegistrations: [{ eventId: priorEventId, event: { name: "Previous event" }, queueEntries: [] }],
  }]);
  replace(t, prisma.auditLog, "create", async ({ data }) => { audit = data; return { id: crypto.randomUUID() }; });

  const result = await participantService.matchParticipantsForRegistrationService(request(participantId, eventId, crypto.randomUUID()));
  assert.equal(result.result, "POSSIBLE_MATCH");
  assert.equal(result.matches[0].previousEvent.eventName, "Previous event");
  assert.equal(audit.action, "PARTICIPANT_CROSS_EVENT_MATCH_CHECKED");
  assert.deepEqual(audit.newValue, { matchCount: 1, outcome: "POSSIBLE_MATCH" });
});

test("reusing a previous-event participant creates target-event intake access and an audit record", async (t) => {
  const participantId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const intakeId = crypto.randomUUID();
  let intakeData;
  let audit;
  const tx = {
    participant: { findUnique: async () => ({ id: participantId, status: "ACTIVE", firstName: "John", lastName: "Tan", dateOfBirth: new Date("2002-03-12T00:00:00.000Z"), contactNumber: "81234567" }) },
    eventRegistration: { findUnique: async () => null },
    participantEventIntake: { upsert: async ({ create }) => { intakeData = create; return { intakeId }; } },
    auditLog: { create: async ({ data }) => { audit = data; return { id: crypto.randomUUID() }; } },
  };
  replace(t, prisma, "$transaction", async (work) => work(tx));

  const result = await participantService.reuseMatchedParticipantService(request(participantId, eventId, userId));
  assert.deepEqual(result, { outcome: "ATTACHED", intakeId });
  assert.deepEqual(intakeData, { participantId, eventId, attachedById: userId, reason: "REUSED_MATCH" });
  assert.equal(audit.action, "PARTICIPANT_REUSED_FOR_EVENT");
  assert.equal(audit.newValue.eventId, eventId);
});

test("current-event duplicates are returned without creating another intake", async (t) => {
  const participantId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  let intakeCreated = false;
  const tx = {
    participant: { findUnique: async () => ({ id: participantId, status: "ACTIVE", firstName: "John", lastName: "Tan", dateOfBirth: new Date("2002-03-12T00:00:00.000Z"), contactNumber: "81234567" }) },
    eventRegistration: { findUnique: async () => ({ registrationId }) },
    participantEventIntake: { upsert: async () => { intakeCreated = true; } },
    auditLog: { create: async () => ({ id: crypto.randomUUID() }) },
  };
  replace(t, prisma, "$transaction", async (work) => work(tx));

  const result = await participantService.reuseMatchedParticipantService(request(participantId, eventId, crypto.randomUUID()));
  assert.deepEqual(result, { outcome: "ALREADY_REGISTERED", registrationId });
  assert.equal(intakeCreated, false);
});

test("cross-event matching is denied without the explicit reuse permission", async () => {
  await assert.rejects(
    participantService.matchParticipantsForRegistrationService({
      ...request(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()),
      auth: { userId: crypto.randomUUID(), permissions: ["participants:read"] },
    }),
    (error) => error.statusCode === 403 && error.message === "Cross-event participant reuse is not authorized",
  );
});
