const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const prisma = require("../../prisma/prismaClient");
const participantService = require("../../services/participant/participantService");
const { assertParticipantEventScope } = require("../../utils/validation/participantEventScope");

function replace(t, target, key, value) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

test("participant detail scope requires a registration, event intake, or creator-owned onboarding record for the assigned event", async () => {
  const participantId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let where;
  const db = {
    participant: {
      findFirst: async ({ where: query }) => {
        where = query;
        return { id: participantId };
      },
    },
  };

  assert.equal(await assertParticipantEventScope(db, participantId, eventId, userId), participantId);
  assert.equal(where.id, participantId);
    assert.deepEqual(where.OR[0], { eventRegistrations: { some: { eventId } } });
  assert.deepEqual(where.OR[1], { eventIntakes: { some: { eventId } } });
  assert.deepEqual(where.OR[2], {
    AND: [
      { createdById: userId },
      { onboardingEventId: eventId },
      { eventRegistrations: { none: {} } },
    ],
  });
  assert.equal(JSON.stringify(where).includes('consents'), false);
});

test("participant detail scope rejects a participant linked only to another event", async () => {
  const db = { participant: { findFirst: async () => null } };

  await assert.rejects(
    assertParticipantEventScope(db, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()),
    (error) => error.statusCode === 403 && error.message === "Participant is outside the assigned event",
  );
});

test("participant search reuses registration or creator-owned onboarding scope and excludes consent", async (t) => {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const captured = [];
  replace(t, prisma.participant, "count", async ({ where }) => { captured.push(where); return 0; });
  replace(t, prisma.participant, "findMany", async ({ where }) => { captured.push(where); return []; });

  await participantService.searchParticipantsService({
    query: { name: "Daniel" },
    registrationEventId: eventId,
    auth: { userId },
  });

  for (const where of captured) {
    const scope = where.AND[1];
    assert.deepEqual(scope.OR[0], { eventRegistrations: { some: { eventId } } });
    assert.deepEqual(scope.OR[1], { eventIntakes: { some: { eventId } } });
    assert.deepEqual(scope.OR[2], {
      AND: [
        { createdById: userId },
        { onboardingEventId: eventId },
        { eventRegistrations: { none: {} } },
      ],
    });
    assert.equal(JSON.stringify(scope).includes("consents"), false);
  }
});

test("participant profile service does not load data outside the current event", async (t) => {
  const participantId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let profileRead = false;
  replace(t, prisma.participant, "findFirst", async () => null);
  replace(t, prisma.participant, "findUnique", async () => { profileRead = true; return null; });

  await assert.rejects(
    participantService.getParticipantByIdService(participantId, eventId, userId),
    (error) => error.statusCode === 403,
  );
  assert.equal(profileRead, false);
});
