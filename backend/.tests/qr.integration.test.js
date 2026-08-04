const crypto = require("node:crypto");
const helpers = require("./helpers");
const qrService = require("../services/qrService");
const { decrypt, encryptionContext } = require("../utils/cryptoUtils");

const createGate = () => {
  let markResolved;
  let release;
  return {
    resolved: new Promise((resolve) => { markResolved = resolve; }),
    released: new Promise((resolve) => { release = resolve; }),
    markResolved,
    release,
  };
};

const pauseAfterInitialQrResolution = (gate) => ({
  $transaction: (work) => helpers.prisma.$transaction(async (tx) => {
    let firstLookup = true;
    const wrappedQrPass = new Proxy(tx.qRCodePass, {
      get(model, property) {
        const value = Reflect.get(model, property);
        if (property !== "findFirst") {
          return typeof value === "function" ? value.bind(model) : value;
        }
        return async (query) => {
          const result = await model.findFirst(query);
          if (firstLookup) {
            firstLookup = false;
            gate.markResolved();
            await gate.released;
          }
          return result;
        };
      },
    });
    const wrappedTx = new Proxy(tx, {
      get(target, property) {
        if (property === "qRCodePass") return wrappedQrPass;
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return work(wrappedTx);
  }),
});

const fixture = async (label) => {
  const user = await helpers.ensureTestUser("REGISTRATION_OFFICER", `${label}-${crypto.randomUUID()}`);
  const startsAt = new Date("2042-08-04T01:00:00.000Z");
  const event = await helpers.prisma.event.create({
    data: {
      name: `QR race ${label}`,
      description: "Real database QR concurrency fixture.",
      venue: "Integration Hall",
      timezone: "Asia/Singapore",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 60 * 60 * 1000),
      capacity: 20,
      status: "IN_PROGRESS",
      createdByUserId: user.id,
    },
  });
  const participant = await helpers.prisma.participant.create({
    data: {
      participantReference: `P-${crypto.randomUUID()}`,
      firstName: "QR",
      lastName: "Race",
      dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
      gender: "U",
      contactNumber: "+6590000000",
      emergencyContact: "+6590000001",
      consentGiven: true,
      createdById: user.id,
      updatedById: user.id,
      onboardingEventId: event.eventId,
    },
  });
  const registration = await helpers.prisma.eventRegistration.create({
    data: {
      eventId: event.eventId,
      participantId: participant.id,
      registeredBy: user.id,
      registrationStatus: "SIGNED_UP",
      idempotencyKey: `qr-race-${crypto.randomUUID()}`,
    },
  });
  await qrService.generateQR(registration.registrationId, user.id);
  const activeQr = await helpers.prisma.qRCodePass.findFirstOrThrow({
    where: { registrationId: registration.registrationId, isActive: true },
    orderBy: { issuedAt: "desc" },
  });
  const token = decrypt(
    activeQr.tokenCiphertext,
    encryptionContext("QRCodePass", activeQr.id, "token"),
  );
  return { activeQr, event, registration, token, user };
};

afterAll(async () => helpers.prisma.$disconnect());

for (const operation of ["revoke", "reissue"]) {
  test(`an old QR cannot check in after concurrent ${operation}`, async () => {
    const { activeQr, event, registration, token, user } = await fixture(operation);
    const gate = createGate();
    const manualCheckIn = qrService.manualCheckIn({
      eventId: event.eventId,
      identifier: token,
      userId: user.id,
    }, pauseAfterInitialQrResolution(gate));
    const rejectedOldToken = expect(manualCheckIn).rejects.toMatchObject({
      code: "INVALID_QR",
      status: 404,
    });

    await gate.resolved;
    let operationError;
    try {
      if (operation === "revoke") {
        await qrService.revokeQR(activeQr.id, "Concurrent integration test", user.id);
      } else {
        await qrService.reissueQR(registration.registrationId, user.id);
      }
    } catch (error) {
      operationError = error;
    } finally {
      gate.release();
    }

    await rejectedOldToken;
    if (operationError) throw operationError;
    const savedRegistration = await helpers.prisma.eventRegistration.findUniqueOrThrow({
      where: { registrationId: registration.registrationId },
    });
    expect(savedRegistration.registrationStatus).toBe("SIGNED_UP");
    expect(savedRegistration.checkedIn).toBe(false);
    const oldQr = await helpers.prisma.qRCodePass.findUniqueOrThrow({ where: { id: activeQr.id } });
    expect(oldQr.isActive).toBe(false);
    const activeCount = await helpers.prisma.qRCodePass.count({
      where: { registrationId: registration.registrationId, isActive: true },
    });
    expect(activeCount).toBe(operation === "reissue" ? 1 : 0);
  });
}
