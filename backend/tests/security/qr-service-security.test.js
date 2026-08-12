const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";

const { encrypt, encryptionContext } = require("../../utils/crypto/cryptoUtils");
const { resolveRegistrationByQrValue } = require("../../utils/crypto/qrToken");
const qrService = require("../../services/participant/qrService");

const eventId = "11111111-1111-4111-8111-111111111111";
const registrationId = "22222222-2222-4222-8222-222222222222";
const qrId = "33333333-3333-4333-8333-333333333333";
const stationId = "44444444-4444-4444-8444-444444444444";

const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");

test("shared scanner resolver accepts only active event-scoped secure passes", async () => {
  const token = "9".repeat(64);
  const queries = [];
  const db = {
    qRCodePass: {
      findFirst: async (query) => {
        queries.push(query);
        return query.where.registration.eventId === eventId ? { registrationId } : null;
      },
    },
    eventRegistration: {
      findFirst: async () => assert.fail("legacy registration credentials must never be queried"),
    },
  };

  assert.deepEqual(await resolveRegistrationByQrValue(db, { eventId, value: token }), { registrationId });
  assert.deepEqual(await resolveRegistrationByQrValue(db, {
    eventId,
    value: `https://app.example.com/participant-status/${token}`,
  }), { registrationId });
  assert.equal(await resolveRegistrationByQrValue(db, { eventId, value: "malformed" }), null);
  assert.equal(await resolveRegistrationByQrValue(db, { eventId, value: "VSMS-DEMO-QR-001" }), null);
  assert.equal(queries.length, 2);
  for (const { where } of queries) {
    assert.equal(where.tokenHash, tokenHash(token));
    assert.equal(where.isActive, true);
    assert.equal(where.revokedAt, null);
    assert.ok(where.expiresAt.gt instanceof Date);
    assert.deepEqual(where.registration, { eventId });
  }
});

test("shared scanner resolver conceals expired, revoked, and cross-event passes", async () => {
  const token = "8".repeat(64);
  const foreignEventId = "99999999-9999-4999-8999-999999999999";
  const db = {
    qRCodePass: {
      findFirst: async ({ where }) => {
        if (where.registration.eventId === foreignEventId) return null;
        if (where.isActive !== true || where.revokedAt !== null || !(where.expiresAt.gt instanceof Date)) {
          assert.fail("resolver omitted the secure pass lifecycle predicate");
        }
        return null;
      },
    },
  };

  assert.equal(await resolveRegistrationByQrValue(db, { eventId, value: token }), null);
  assert.equal(await resolveRegistrationByQrValue(db, { eventId: foreignEventId, value: token }), null);
});

test("active-pass rendering never falls back to EventRegistration.passToken", async () => {
  const db = {
    eventRegistration: {
      findUnique: async () => ({
        registrationId,
        passToken: "legacy-token",
        queueNumber: 7,
        participant: { firstName: "Ada", lastName: "Lovelace" },
      }),
    },
    qRCodePass: { findFirst: async () => null },
  };

  await assert.rejects(
    qrService.renderActivePassForRegistration(registrationId, db),
    (error) => error.code === "QR_NOT_FOUND" && !error.message.includes("legacy-token"),
  );
});

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
  assert.match(result.qrImage, /^data:image\/svg\+xml;base64,/);
  const branded = Buffer.from(result.qrImage.split(",")[1], "base64").toString("utf8");
  assert.match(branded, /^<svg/);
  assert.doesNotMatch(branded, /VSMS|SECURE EVENT PASS/);
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

test("the same secure pass remains valid through the event end", async () => {
  const token = "e".repeat(64);
  const eventEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const existing = {
    id: qrId,
    registrationId,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    tokenEncryptionVersion: 2,
    tokenCiphertext: encrypt(token, encryptionContext("QRCodePass", qrId, "token")),
  };
  let update;
  const tx = {
    eventRegistration: { findUnique: async () => ({ registrationId, event: { endsAt: eventEndsAt } }) },
    qRCodePass: {
      findFirst: async () => existing,
      update: async (query) => {
        update = query;
        return { ...existing, expiresAt: query.data.expiresAt };
      },
    },
    auditLog: { create: async () => ({}) },
  };

  const result = await qrService.generateQR(registrationId, null, tx);
  assert.equal(result.qrId, qrId);
  assert.deepEqual(update, { where: { id: qrId }, data: { expiresAt: eventEndsAt } });
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
  assert.match(result.qrImage, /^data:image\/svg\+xml;base64,/);
  const branded = Buffer.from(result.qrImage.split(",")[1], "base64").toString("utf8");
  assert.match(branded, /^<svg/);
  assert.doesNotMatch(branded, /VSMS|SECURE EVENT PASS/);
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
  const qrQueries = [];
  let registrationQuery;
  let updateQuery;
  let audit;
  const db = {
    $transaction: async (work) => work({
      qRCodePass: {
        findFirst: async (query) => {
          qrQueries.push(query);
          return qrQueries.length === 1
            ? { id: qrId, registrationId, registration: { eventId } }
            : { id: qrId, registrationId };
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
        findUnique: async () => ({
          registrationId,
          eventId,
          routeVersion: 1,
          event: { status: "IN_PROGRESS" },
        }),
      },
      registrationRouteStep: { findMany: async () => [] },
      station: { findMany: async () => [] },
      queueEntry: { findMany: async () => [] },
      eventStationAvailability: { findMany: async () => [] },
      auditLog: { create: async ({ data }) => { audit = data; return data; } },
    }),
  };

  const result = await qrService.manualCheckIn({ identifier: token, eventId, userId: qrId }, db);

  assert.deepEqual(qrQueries[0].select, {
    id: true,
    registrationId: true,
  });
  assert.equal(qrQueries[0].where.tokenHash, tokenHash(token));
  assert.deepEqual(qrQueries[0].where.registration, { eventId });
  assert.equal(JSON.stringify(qrQueries[0]).includes(token), false);
  assert.deepEqual(qrQueries[1].select, { id: true, registrationId: true });
  assert.equal(qrQueries[1].where.id, qrId);
  assert.equal(qrQueries[1].where.registrationId, registrationId);
  assert.equal(qrQueries[1].where.isActive, true);
  assert.ok(qrQueries[1].where.expiresAt.gt instanceof Date);
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
  assert.deepEqual(Object.keys(result).sort(), ["checkedIn", "checkedInAt", "eventId", "queueNumber", "registrationId", "registrationStatus", "route"]);
  assert.equal(result.route.status, "NO_SCREENING_STATIONS");
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
        findUnique: async () => ({
          registrationId,
          eventId,
          routeVersion: 1,
          event: { status: "IN_PROGRESS" },
        }),
      },
      registrationRouteStep: { findMany: async () => [] },
      station: { findMany: async () => [] },
      queueEntry: { findMany: async () => [] },
      eventStationAvailability: { findMany: async () => [] },
      auditLog: { create: async ({ data }) => { audit = data; return data; } },
    }),
  };

  const result = await qrService.manualCheckIn({ registrationId, eventId, userId: qrId }, db);

  assert.equal(qrLookup, false);
  assert.deepEqual(audit.newValue, { eventId, checkInMethod: "REGISTRATION_REFERENCE" });
  assert.deepEqual(Object.keys(result).sort(), ["checkedIn", "checkedInAt", "eventId", "queueNumber", "registrationId", "registrationStatus", "route"]);
});

test("manual check-in rejects NRIC input", async () => {
  let openedTransaction = false;
  const invalidDb = { $transaction: async () => { openedTransaction = true; } };
  await assert.rejects(
    qrService.manualCheckIn({ identifier: "S1234567A", eventId, userId: qrId }, invalidDb),
    (error) => error.code === "INVALID_QR" && error.status === 400,
  );
  assert.equal(openedTransaction, false);
});

test("unknown and cross-event QR tokens have the same concealed error and event-scoped lookup", async () => {
  const unknownToken = "a".repeat(64);
  const foreignToken = "f".repeat(64);
  const foreignEventId = "99999999-9999-4999-8999-999999999999";
  const queries = [];
  let updated = false;
  const db = {
    $transaction: async (work) => work({
      qRCodePass: {
        findFirst: async (query) => {
          queries.push(query);
          const isForeignToken = query.where.tokenHash === tokenHash(foreignToken);
          if (isForeignToken && query.where.registration?.eventId === foreignEventId) {
            return { id: qrId, registrationId };
          }
          return null;
        },
      },
      eventRegistration: { updateMany: async () => { updated = true; return { count: 1 }; } },
      auditLog: { create: async () => ({}) },
    }),
  };

  const publicError = async (identifier) => {
    try {
      await qrService.manualCheckIn({ identifier, eventId, userId: qrId }, db);
      assert.fail("manual check-in unexpectedly succeeded");
    } catch (error) {
      return { status: error.status, code: error.code, message: error.message };
    }
  };

  const unknownError = await publicError(unknownToken);
  const foreignError = await publicError(foreignToken);

  assert.deepEqual(unknownError, {
    status: 404,
    code: "INVALID_QR",
    message: "QR Code is invalid, expired, or unavailable.",
  });
  assert.deepEqual(foreignError, unknownError);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.deepEqual(query.where.registration, { eventId });
  }
  assert.equal(queries[1].where.tokenHash, tokenHash(foreignToken));
  assert.equal(updated, false);
});

test("manual check-in requires exactly one registration reference or QR token", async () => {
  let openedTransactions = 0;
  const db = { $transaction: async () => { openedTransactions += 1; } };

  for (const params of [
    { eventId, userId: qrId },
    { eventId, userId: qrId, registrationId, identifier: "a".repeat(64) },
  ]) {
    await assert.rejects(
      qrService.manualCheckIn(params, db),
      (error) => error.code === "CHECKIN_REFERENCE_REQUIRED" && error.status === 400,
    );
  }

  assert.equal(openedTransactions, 0);
});

test("missing and cross-event registration references have the same concealed error", async () => {
  const foreignRegistrationId = "88888888-8888-4888-8888-888888888888";
  const lockQueries = [];
  const publicErrors = [];

  for (const candidate of [registrationId, foreignRegistrationId]) {
    const db = {
      $transaction: async (work) => work({
        $queryRaw: async (strings, ...values) => {
          const sql = strings.join("?");
          lockQueries.push({ sql, values });
          const eventScoped = sql.includes("event_id = CAST(");
          return candidate === foreignRegistrationId && !eventScoped
            ? [{ registration_id: candidate }]
            : [];
        },
        eventRegistration: { findFirst: async () => null },
        auditLog: { create: async () => ({}) },
      }),
    };

    try {
      await qrService.manualCheckIn({ registrationId: candidate, eventId, userId: qrId }, db);
      assert.fail("Expected concealed registration lookup failure.");
    } catch (error) {
      publicErrors.push({ status: error.status, code: error.code, message: error.message });
    }
  }

  assert.deepEqual(publicErrors, [
    { status: 404, code: "REGISTRATION_NOT_FOUND", message: "Registration record was not found for this event." },
    { status: 404, code: "REGISTRATION_NOT_FOUND", message: "Registration record was not found for this event." },
  ]);
  assert.equal(lockQueries.length, 2);
  for (const lock of lockQueries) {
    assert.match(lock.sql, /event_id = CAST\(/);
    assert.ok(lock.values.includes(eventId));
  }
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

test("each issuance mints a unique opaque token and supersedes the prior active pass", async () => {
  const issuedAt = new Date();
  const createdHashes = [];
  const issuedIds = [];
  const tx = {
    eventRegistration: {
      findUnique: async () => ({ registrationId, eventId, participant: {}, event: {} }),
    },
    qRCodePass: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        createdHashes.push(data.tokenHash);
        issuedIds.push(data.id);
        return { id: data.id, issuedAt, ...data };
      },
    },
    auditLog: { create: async () => ({}) },
  };

  await qrService.generateQR(registrationId, null, tx);
  await qrService.generateQR(registrationId, null, tx);
  await qrService.generateQR(registrationId, null, tx);

  assert.equal(createdHashes.length, 3);
  assert.equal(new Set(createdHashes).size, 3);
  assert.equal(issuedIds.length, new Set(issuedIds).size);
  for (const hash of createdHashes) assert.match(hash, /^[a-f0-9]{64}$/);
});

test("public pass status reveals no PII and reports expired or revoked passes as invalid", async () => {
  const token = "d".repeat(64);
  let where;
  const db = {
    qRCodePass: {
      findFirst: async (query) => {
        where = query.where;
        return {
          expiresAt: new Date(Date.now() + 60_000),
          registration: {
            queueNumber: 42,
            registrationStatus: "CHECKED_IN",
            event: { name: "Community Vision Screening" },
            routeSteps: [
              {
                position: 1,
                completedAt: new Date(),
                station: { stationId: "station-1", stationName: "Visual Acuity", stationType: "VISUAL_ACUITY" },
              },
              {
                position: 2,
                completedAt: null,
                station: { stationId: "station-2", stationName: "Refraction", stationType: "REFRACTION" },
              },
            ],
            queueEntries: [{
              status: "WAITING",
              queueNumber: 42,
              station: { stationId: "station-2", stationName: "Refraction", stationType: "REFRACTION" },
            }],
          },
        };
      },
    },
  };

  const valid = await qrService.getPublicStatus(token, db);
  assert.equal(valid.valid, true);
  assert.equal(valid.eventName, "Community Vision Screening");
  assert.equal(valid.queueNumber, 42);
  assert.deepEqual(valid.route.map(({ stationName, state }) => [stationName, state]), [
    ["Visual Acuity", "COMPLETED"],
    ["Refraction", "CURRENT"],
    ["Clinical review", "UPCOMING"],
  ]);
  assert.deepEqual(Object.keys(valid).sort(), ["eventName", "expiresAt", "queueNumber", "queueState", "registrationStatus", "route", "valid"]);
  assert.equal(where.tokenHash, tokenHash(token));
  assert.equal(where.isActive, true);
  assert.equal(where.revokedAt, null);
  assert.ok(where.expiresAt.gt instanceof Date);
  const publicJson = JSON.stringify(valid);
  for (const forbidden of ["stationId", "registrationId", "routeStepId", "actor", "audit", "capacity", "workload", "result", "nric"]) {
    assert.equal(publicJson.includes(forbidden), false);
  }

  const revokedDb = { qRCodePass: { findFirst: async () => null } };
  const revoked = await qrService.getPublicStatus(token, revokedDb);
  assert.equal(revoked.valid, false);
  assert.equal(revoked.eventName, null);

  const expiredDb = { qRCodePass: { findFirst: async () => null } };
  const expired = await qrService.getPublicStatus(token, expiredDb);
  assert.deepEqual(expired, revoked);
});
