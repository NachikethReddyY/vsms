const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
process.env.PARTICIPANT_LOOKUP_HMAC_KEY ||= "a".repeat(64);

const {
  nricLookupHash,
  protectParticipantNric,
  revealParticipantNric,
} = require("../../backend/utils/crypto/participantIdentity");
const { backfillParticipantNric } = require("../../backend/scripts/backfill-participant-nric");
const prisma = require("../../backend/prisma/prismaClient");
const participantService = require("../../backend/services/participant/participantService");

test("participant NRIC protection stores ciphertext and a deterministic keyed lookup index", () => {
  const participantId = crypto.randomUUID();
  const nric = "S1234567D";
  const protectedFields = protectParticipantNric(participantId, nric);

  assert.equal(protectedFields.nric, null);
  assert.equal(protectedFields.nricEncryptionVersion, 2);
  assert.equal(protectedFields.nricMasked, "•••••567D");
  assert.equal(protectedFields.nricLookupHash, nricLookupHash(nric));
  assert.equal(protectedFields.nricCiphertext.includes(nric), false);
  assert.equal(revealParticipantNric({ id: participantId, ...protectedFields }), nric);
});

test("NRIC ciphertext is bound to its participant record", () => {
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const protectedFields = protectParticipantNric(firstId, "S1234567D");

  assert.throws(
    () => revealParticipantNric({ id: secondId, ...protectedFields }),
    /authenticate data|authentication failed|Unsupported state/i,
  );
});

test("legacy NRIC backfill clears plaintext and verifies complete coverage", async () => {
  const rows = [
    { id: crypto.randomUUID(), nric: "S1234567D", nricCiphertext: null, nricLookupHash: null, nricEncryptionVersion: null },
    { id: crypto.randomUUID(), nric: "T7654321A", nricCiphertext: null, nricLookupHash: null, nricEncryptionVersion: null },
  ];
  const participant = {
    findMany: async () => rows.filter((row) => row.nric && !row.nricCiphertext).map(({ id, nric }) => ({ id, nric })),
    updateMany: async ({ where, data }) => {
      const row = rows.find((candidate) => candidate.id === where.id && candidate.nric === where.nric && !candidate.nricCiphertext);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    count: async ({ where }) => where.nric
      ? rows.filter((row) => row.nric != null).length
      : rows.filter((row) => !row.nricCiphertext || !row.nricLookupHash || row.nricEncryptionVersion !== 2).length,
  };
  const db = { participant, $transaction: async (work) => work({ participant }) };

  const result = await backfillParticipantNric(db);

  assert.deepEqual(result, { migrated: 2, remainingLegacyRows: 0, incompleteEncryptedRows: 0 });
  assert.equal(rows.every((row) => row.nric === null), true);
  assert.equal(rows.every((row) => row.nricEncryptionVersion === 2), true);
});

test("participant creation never sends plaintext NRIC to Prisma or the API response", async () => {
  const originalTransaction = prisma.$transaction;
  let createData;
  prisma.$transaction = async (work) => work({
    participant: {
      create: async ({ data }) => {
        createData = data;
        return { ...data, createdAt: new Date(), updatedAt: new Date() };
      },
    },
    auditLog: { create: async ({ data }) => data },
  });

  try {
    const result = await participantService.createParticipantService({
      body: {
        firstName: "John",
        lastName: "Tan",
        dateOfBirth: "1980-03-14",
        gender: "M",
        contactNumber: "+6591234567",
        email: "john.tan@example.test",
        race: "Chinese",
        nationality: "Singaporean",
        addressStreet: "1 Test Street",
        addressUnit: "#01-01",
        addressPostalCode: "123456",
        preferredLanguage: "English",
        nric: "S1234567D",
      },
      auth: { userId: crypto.randomUUID() },
      registrationEventId: crypto.randomUUID(),
      context: {},
    });

    assert.equal(createData.nric, null);
    assert.equal(createData.nricCiphertext.includes("S1234567D"), false);
    assert.equal(JSON.stringify(result).includes("S1234567D"), false);
    assert.equal("nricCiphertext" in result, false);
    assert.equal("nricLookupHash" in result, false);
    assert.equal(result.nricMasked, "•••••567D");
  } finally {
    prisma.$transaction = originalTransaction;
  }
});
