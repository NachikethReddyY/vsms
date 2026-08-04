const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { encrypt, encryptionContext } = require("../utils/cryptoUtils");
const qrService = require("../services/qrService");

const eventId = "11111111-1111-4111-8111-111111111111";
const registrationId = "22222222-2222-4222-8222-222222222222";
const qrId = "33333333-3333-4333-8333-333333333333";

const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");

test("token access hashes the bearer and requires an active, unexpired pass", async () => {
  const token = "a".repeat(64);
  let where;
  const db = {
    qRCodePass: {
      findFirst: async (query) => {
        where = query.where;
        return { registration: { eventId } };
      },
    },
  };

  assert.equal(await qrService.getEventIdForAccess({ token }, db), eventId);
  assert.equal(where.tokenHash, tokenHash(token));
  assert.equal(where.isActive, true);
  assert.ok(where.expiresAt.gt instanceof Date);
  assert.equal(JSON.stringify(where).includes(token), false);
});

test("QR lookups return only the operational registration projection", async () => {
  const token = "d".repeat(64);
  const expiresAt = new Date(Date.now() + 60_000);
  const queries = [];
  const db = {
    qRCodePass: {
      findFirst: async (query) => {
        queries.push(query);
        return {
          id: qrId,
          registrationId,
          tokenHash: tokenHash(token),
          tokenCiphertext: "v2:secret",
          expiresAt,
          isActive: true,
          registration: {
            registrationId,
            eventId,
            participantId: "44444444-4444-4444-8444-444444444444",
            registeredBy: "55555555-5555-4555-8555-555555555555",
            registrationStatus: "SIGNED_UP",
            queueNumber: 7,
            checkedIn: false,
            passToken: "registration-secret",
            idempotencyKey: "registration-idempotency-key",
            participant: {
              firstName: "Ada",
              lastName: "Lovelace",
              nric: "encrypted-nric",
              contactNumber: "+6512345678",
              consentGiven: true,
              createdById: "66666666-6666-4666-8666-666666666666",
            },
            event: {
              eventId,
              name: "Community screening",
              description: "Internal event details",
              createdByUserId: "77777777-7777-4777-8777-777777777777",
              createIdempotencyKey: "event-idempotency-key",
            },
          },
        };
      },
    },
  };

  const participant = await qrService.getParticipant(token, db);
  const registration = await qrService.getRegistrationByQR(token, db);

  assert.deepEqual(participant, {
    qrId,
    registrationId,
    participant: { firstName: "Ada", lastName: "Lovelace" },
    event: { eventId, name: "Community screening" },
    queueNumber: 7,
    expiresAt,
    isActive: true,
  });
  assert.deepEqual(registration, {
    registrationId,
    eventId,
    registrationStatus: "SIGNED_UP",
    queueNumber: 7,
    checkedIn: false,
    participant: { firstName: "Ada", lastName: "Lovelace" },
    event: { eventId, name: "Community screening" },
  });

  for (const query of queries) {
    assert.equal(query.include, undefined);
    assert.equal(query.where.tokenHash, tokenHash(token));
    assert.equal(query.where.isActive, true);
    assert.ok(query.where.expiresAt.gt instanceof Date);
  }
  assert.deepEqual(queries[0].select, {
    id: true,
    registrationId: true,
    expiresAt: true,
    isActive: true,
    registration: {
      select: {
        registrationId: true,
        queueNumber: true,
        participant: { select: { firstName: true, lastName: true } },
        event: { select: { eventId: true, name: true } },
      },
    },
  });
  assert.deepEqual(queries[1].select, {
    registration: {
      select: {
        registrationId: true,
        queueNumber: true,
        participant: { select: { firstName: true, lastName: true } },
        event: { select: { eventId: true, name: true } },
        eventId: true,
        registrationStatus: true,
        checkedIn: true,
      },
    },
  });
});

test("generated QR passes retain only a hash and authenticated ciphertext", async () => {
  let supersededWhere;
  let created;
  const issuedAt = new Date();
  const tx = {
    eventRegistration: {
      findUnique: async () => ({ registrationId, eventId, participant: {}, event: {} }),
    },
    qRCodePass: {
      findFirst: async () => null,
      updateMany: async (query) => {
        supersededWhere = query.where;
        return { count: 0 };
      },
      create: async ({ data }) => {
        created = data;
        return { id: data.id, issuedAt, expiresAt: data.expiresAt };
      },
    },
    auditLog: { create: async () => ({}) },
  };

  const result = await qrService.generateQR(registrationId, null, tx);
  assert.equal(Object.hasOwn(created, "token"), false);
  assert.match(created.tokenHash, /^[a-f0-9]{64}$/);
  assert.match(created.tokenCiphertext, /^v2:/);
  assert.equal(created.tokenEncryptionVersion, 2);
  assert.equal(supersededWhere.registrationId, registrationId);
  assert.equal(supersededWhere.isActive, true);
  assert.equal(supersededWhere.expiresAt, undefined);
  assert.equal(Object.hasOwn(result, "token"), false);
  assert.equal(Object.hasOwn(result, "targetUrl"), false);
  assert.match(result.qrImage, /^data:image\/png;base64,/);
});

test("serialized concurrent first issuance returns one database pass", async () => {
  let active = null;
  let creates = 0;
  let locks = 0;
  const tx = {
    $queryRaw: async () => { locks += 1; return [{ registration_id: registrationId }]; },
    eventRegistration: {
      findUnique: async () => ({ registrationId, eventId, participant: {}, event: {} }),
    },
    qRCodePass: {
      findFirst: async () => active,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        creates += 1;
        active = { ...data, issuedAt: new Date() };
        return active;
      },
    },
    auditLog: { create: async () => ({}) },
  };

  const first = await qrService.generateQR(registrationId, null, tx);
  const second = await qrService.generateQR(registrationId, null, tx);
  assert.equal(first.qrId, second.qrId);
  assert.equal(creates, 1);
  assert.equal(locks, 2);
});

test("download renders an active pass from encrypted storage without returning its target URL", async () => {
  const token = "b".repeat(64);
  let where;
  const db = {
    qRCodePass: {
      findFirst: async (query) => {
        where = query.where;
        return {
          id: qrId,
          registrationId,
          expiresAt: new Date(Date.now() + 60_000),
          tokenCiphertext: encrypt(token, encryptionContext("QRCodePass", qrId, "token")),
          tokenEncryptionVersion: 2,
        };
      },
    },
  };

  const result = await qrService.downloadQR(qrId, db);
  assert.equal(where.id, qrId);
  assert.equal(where.isActive, true);
  assert.ok(where.expiresAt.gt instanceof Date);
  assert.equal(Object.hasOwn(result, "targetUrl"), false);
  assert.match(result.qrImage, /^data:image\/png;base64,/);
});

test("verification rejects any pass that does not satisfy the shared active-expiry predicate", async () => {
  const db = {
    $transaction: async (work) => work({
      qRCodePass: { findFirst: async () => null },
      auditLog: { create: async () => ({}) },
    }),
  };

  await assert.rejects(
    qrService.verifyQR("c".repeat(64), eventId, null, db),
    (error) => error.code === "INVALID_QR" && error.status === 404,
  );
});

test("manual QR check-in writes no bearer or participant data and returns a minimal projection", async () => {
  const token = "e".repeat(64);
  let qrQuery;
  let registrationQuery;
  let updateQuery;
  let audit;
  const db = {
    $transaction: async (work) => work({
      qRCodePass: {
        findFirst: async (query) => {
          qrQuery = query;
          return { registrationId, registration: { eventId } };
        },
      },
      eventRegistration: {
        findFirst: async (query) => {
          registrationQuery = query;
          return {
            registrationId,
            eventId,
            registrationStatus: "SIGNED_UP",
            checkedIn: false,
            checkedInAt: null,
            queueNumber: 7,
            participant: { nric: "encrypted-nric", firstName: "Ada" },
            event: { name: "Internal event" },
          };
        },
        updateMany: async (query) => {
          updateQuery = query;
          return { count: 1 };
        },
      },
      auditLog: { create: async ({ data }) => { audit = data; return data; } },
    }),
  };

  const result = await qrService.manualCheckIn({ identifier: token, eventId, userId: qrId }, db);

  assert.deepEqual(qrQuery.select, {
    registrationId: true,
    registration: { select: { eventId: true } },
  });
  assert.equal(qrQuery.where.tokenHash, tokenHash(token));
  assert.equal(JSON.stringify(qrQuery).includes(token), false);
  assert.deepEqual(registrationQuery.select, {
    registrationId: true,
    eventId: true,
    registrationStatus: true,
    checkedIn: true,
    checkedInAt: true,
    queueNumber: true,
  });
  assert.deepEqual(updateQuery.where, {
    registrationId,
    eventId,
    registrationStatus: "SIGNED_UP",
    checkedIn: false,
  });
  assert.equal(updateQuery.data.registrationStatus, "CHECKED_IN");
  assert.equal(updateQuery.data.checkedIn, true);
  assert.ok(updateQuery.data.checkedInAt instanceof Date);
  assert.deepEqual(audit.newValue, { eventId, checkInMethod: "QR_TOKEN" });
  assert.equal(JSON.stringify(audit).includes(token), false);
  assert.equal(JSON.stringify(audit).includes("encrypted-nric"), false);
  assert.deepEqual(Object.keys(result).sort(), ["checkedIn", "checkedInAt", "eventId", "queueNumber", "registrationId", "registrationStatus"]);
  assert.equal(result.registrationStatus, "CHECKED_IN");
  assert.equal(result.checkedIn, true);
  assert.equal(JSON.stringify(result).includes("Ada"), false);
  assert.equal(JSON.stringify(result).includes("encrypted-nric"), false);
});

test("manual registration-reference check-in does not resolve participant identifiers", async () => {
  let qrLookup = false;
  let audit;
  const db = {
    $transaction: async (work) => work({
      qRCodePass: { findFirst: async () => { qrLookup = true; return null; } },
      eventRegistration: {
        findFirst: async () => ({
          registrationId,
          eventId,
          registrationStatus: "SIGNED_UP",
          checkedIn: false,
          checkedInAt: null,
          queueNumber: null,
        }),
        updateMany: async () => ({ count: 1 }),
      },
      auditLog: { create: async ({ data }) => { audit = data; return data; } },
    }),
  };

  const result = await qrService.manualCheckIn({ registrationId, eventId, userId: qrId }, db);

  assert.equal(qrLookup, false);
  assert.deepEqual(audit.newValue, { eventId, checkInMethod: "REGISTRATION_REFERENCE" });
  assert.deepEqual(Object.keys(result).sort(), ["checkedIn", "checkedInAt", "eventId", "queueNumber", "registrationId", "registrationStatus"]);
});

test("manual check-in rejects NRIC input and QR tokens from another event", async () => {
  let openedTransaction = false;
  const invalidDb = { $transaction: async () => { openedTransaction = true; } };
  await assert.rejects(
    qrService.manualCheckIn({ identifier: "S1234567A", eventId, userId: qrId }, invalidDb),
    (error) => error.code === "INVALID_QR" && error.status === 400,
  );
  assert.equal(openedTransaction, false);

  let updated = false;
  const wrongEventDb = {
    $transaction: async (work) => work({
      qRCodePass: { findFirst: async () => ({ registrationId, registration: { eventId: "99999999-9999-4999-8999-999999999999" } }) },
      eventRegistration: { updateMany: async () => { updated = true; return { count: 1 }; } },
      auditLog: { create: async () => ({}) },
    }),
  };
  await assert.rejects(
    qrService.manualCheckIn({ identifier: "f".repeat(64), eventId, userId: qrId }, wrongEventDb),
    (error) => error.code === "QR_EVENT_MISMATCH" && error.status === 400,
  );
  assert.equal(updated, false);
});

test("manual check-in cannot reopen terminal registrations or win a stale update race", async () => {
  for (const [registrationStatus, checkedIn] of [["CANCELLED", false], ["COMPLETED", false], ["CHECKED_IN", true]]) {
    let updated = false;
    const db = {
      $transaction: async (work) => work({
        eventRegistration: {
          findFirst: async () => ({ registrationId, eventId, registrationStatus, checkedIn, checkedInAt: null, queueNumber: 1 }),
          updateMany: async () => { updated = true; return { count: 1 }; },
        },
        auditLog: { create: async () => ({}) },
      }),
    };
    await assert.rejects(
      qrService.manualCheckIn({ registrationId, eventId, userId: qrId }, db),
      (error) => error.code === "CHECKIN_STATE_CONFLICT" && error.status === 409,
    );
    assert.equal(updated, false);
  }

  let auditWrites = 0;
  const staleDb = {
    $transaction: async (work) => work({
      eventRegistration: {
        findFirst: async () => ({ registrationId, eventId, registrationStatus: "SIGNED_UP", checkedIn: false, checkedInAt: null, queueNumber: 1 }),
        updateMany: async () => ({ count: 0 }),
      },
      auditLog: { create: async () => { auditWrites += 1; return {}; } },
    }),
  };
  await assert.rejects(
    qrService.manualCheckIn({ registrationId, eventId, userId: qrId }, staleDb),
    (error) => error.code === "CHECKIN_STATE_CONFLICT" && error.status === 409,
  );
  assert.equal(auditWrites, 0);
});
