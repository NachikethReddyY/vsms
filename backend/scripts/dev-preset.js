const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const env = require("../config/env");
const { encrypt, encryptionContext } = require("../utils/crypto/cryptoUtils");

if (env.isProduction) throw new Error("Development preset execution is forbidden in production");

const PRESET_TOKEN = "cd".repeat(32);
const PRESET_QR_ID = "cdcdcdcd-0000-4000-8000-000000000001";
const PRESET_STAFF_EMAIL = "preset.admin@cryptix.local";

const demoDate = (dayOffset, hour = 0, minute = 0) => {
  // Events use Asia/Singapore; store the matching UTC instant in PostgreSQL.
  const singaporeOffsetMs = 8 * 60 * 60 * 1000;
  const singaporeNow = new Date(Date.now() + singaporeOffsetMs);
  return new Date(Date.UTC(
    singaporeNow.getUTCFullYear(),
    singaporeNow.getUTCMonth(),
    singaporeNow.getUTCDate() + dayOffset,
    hour - 8,
    minute,
    0,
    0,
  ));
};

const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

async function upsertPresetStaff() {
  return prisma.user.upsert({
    where: { email: PRESET_STAFF_EMAIL },
    update: { status: "ACTIVE", sysRole: "ADMIN" },
    create: {
      username: PRESET_STAFF_EMAIL,
      fullName: "Preset Administrator",
      email: PRESET_STAFF_EMAIL,
      employeeNumber: "PRESET-ADMIN-001",
      department: "Operations",
      designation: "Event Administrator",
      status: "ACTIVE",
      sysRole: "ADMIN",
    },
  });
}

async function upsertPresetEvent(staff) {
  return prisma.event.upsert({
    where: {
      createdByUserId_createIdempotencyKey: {
        createdByUserId: staff.id,
        createIdempotencyKey: "preset-demo-jurong",
      },
    },
    update: {
      name: "Vision Screening - Jurong Live",
      venue: "Jurong Regional Library",
      status: "IN_PROGRESS",
      startsAt: demoDate(0),
      endsAt: demoDate(0, 23, 59),
      capacity: 80,
      expectedAttendance: 60,
    },
    create: {
      name: "Vision Screening - Jurong Live",
      description: "Preset demonstration event for the participant journey and screener handoff.",
      bannerKey: "COMMUNITY_SCREENING",
      venue: "Jurong Regional Library",
      address: "21 Jurong East Central 1, Singapore 609732",
      postalCode: "609732",
      timezone: "Asia/Singapore",
      startsAt: demoDate(0),
      endsAt: demoDate(0, 23, 59),
      capacity: 80,
      expectedAttendance: 60,
      status: "IN_PROGRESS",
      createdByUserId: staff.id,
      createIdempotencyKey: "preset-demo-jurong",
      createPayloadHash: crypto.createHash("sha256").update("preset-demo-jurong").digest("hex"),
    },
  });
}

async function upsertStations(event) {
  const { SYSTEM_FIELD_SCHEMAS } = require("../schemas/dynamicStationSchema");
  const definitions = [
    ["VISUAL_ACUITY", "Visual acuity", 1],
    ["REFRACTION", "Refraction", 2],
    ["COLOUR_VISION", "Colour vision", 3],
    ["EYE_HEALTH", "Eye health", 4],
  ];
  const stations = [];
  for (const [stationType, stationName, stationOrder] of definitions) {
    const fieldSchema = SYSTEM_FIELD_SCHEMAS[stationType] || null;
    const existing = await prisma.station.findFirst({
      where: { eventId: event.eventId, stationType },
    });
    stations.push(existing
      ? await prisma.station.update({
        where: { stationId: existing.stationId },
        data: {
          stationName,
          stationOrder,
          isActive: true,
          fieldSchemaSnapshot: fieldSchema,
          schemaVersion: 1,
        },
      })
      : await prisma.station.create({
        data: {
          eventId: event.eventId,
          stationType,
          stationName,
          stationOrder,
          isActive: true,
          fieldSchemaSnapshot: fieldSchema,
          schemaVersion: 1,
        },
      }));
  }
  return stations;
}

async function upsertParticipant(staff, { participantReference, firstName, lastName, queueNumber }) {
  const participant = await prisma.participant.upsert({
    where: { participantReference },
    update: {
      firstName,
      lastName,
      status: "ACTIVE",
      updatedById: staff.id,
    },
    create: {
      participantReference,
      nric: crypto.randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase(),
      nricMasked: "••••0001",
      firstName,
      lastName,
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "U",
      contactNumber: "+65 8000 0001",
      email: `${participantReference.toLowerCase()}@example.test`,
      preferredLanguage: "English",
      status: "ACTIVE",
      createdById: staff.id,
      updatedById: staff.id,
    },
  });
  return participant;
}

async function upsertRegistration(staff, event, participant, queueNumber, idempotencyKey, { checkedIn = true } = {}) {
  const registration = await prisma.eventRegistration.upsert({
    where: { participantId_eventId: { participantId: participant.id, eventId: event.eventId } },
    update: {
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber,
      checkedIn,
      checkedInAt: checkedIn ? new Date() : null,
    },
    create: {
      participantId: participant.id,
      eventId: event.eventId,
      registeredBy: staff.id,
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber,
      idempotencyKey,
      checkedIn,
      checkedInAt: checkedIn ? new Date() : null,
    },
  });
  return registration;
}

async function upsertPresetPass(registration) {
  const tokenHash = crypto.createHash("sha256").update(PRESET_TOKEN).digest("hex");
  const existing = await prisma.qRCodePass.findFirst({
    where: { tokenHash },
    select: { id: true },
  });
  const qrId = existing?.id || PRESET_QR_ID;

  await prisma.qRCodePass.updateMany({
    where: { registrationId: registration.registrationId, isActive: true, id: { not: qrId } },
    data: { isActive: false, revokedAt: new Date(), revokedReason: "Superseded by preset pass" },
  });

  return prisma.qRCodePass.upsert({
    where: { id: qrId },
    update: {
      registrationId: registration.registrationId,
      tokenHash,
      tokenCiphertext: encrypt(PRESET_TOKEN, encryptionContext("QRCodePass", qrId, "token")),
      tokenEncryptionVersion: 2,
      expiresAt,
      isActive: true,
      revokedAt: null,
      revokedBy: null,
      revokedReason: null,
    },
    create: {
      id: qrId,
      registrationId: registration.registrationId,
      tokenHash,
      tokenCiphertext: encrypt(PRESET_TOKEN, encryptionContext("QRCodePass", qrId, "token")),
      tokenEncryptionVersion: 2,
      expiresAt,
      isActive: true,
    },
  });
}

async function main() {
  const staff = await upsertPresetStaff();
  const event = await upsertPresetEvent(staff);
  await upsertStations(event);

  const ahead = [
    ["VSMS-PRESET-0001", "Ahead", "One", 1],
    ["VSMS-PRESET-0002", "Ahead", "Two", 2],
  ];
  for (const [reference, firstName, lastName, queueNumber] of ahead) {
    const participant = await upsertParticipant(staff, { participantReference: reference, firstName, lastName });
    await upsertRegistration(staff, event, participant, queueNumber, `preset-reg-${reference}`);
  }

  const me = await upsertParticipant(staff, {
    participantReference: "VSMS-PRESET-0003",
    firstName: "Preset",
    lastName: "Tester",
  });
  const registration = await upsertRegistration(staff, event, me, 3, "preset-reg-VSMS-PRESET-0003", { checkedIn: false });
  await upsertPresetPass(registration);

  const origin = env.publicAppOrigin;
  const apiOrigin = `https://localhost:${env.PORT}/api/v1`;
  const stations = [
    ["VISUAL_ACUITY", "visual-acuity"],
    ["REFRACTION", "refraction"],
    ["COLOUR_VISION", "colour-vision"],
  ];

  console.log("========================================");
  console.log("VSMS participant journey preset is ready");
  console.log("========================================");
  console.log(`Event:         ${event.name} (${event.eventId})`);
  console.log(`Registration:  ${registration.registrationId}`);
  console.log(`QR token:      ${PRESET_TOKEN}`);
  console.log("");
  console.log("1) Participant status page (open in a phone/desktop browser)");
  console.log(`   ${origin}/participant-status/${PRESET_TOKEN}`);
  console.log("");
  console.log("2) Status JSON API (the poller hits this every 5s)");
  console.log(`   ${apiOrigin}/qr/public-status/${PRESET_TOKEN}`);
  console.log("");
  console.log("3) Present the same participant QR at every assigned station");
  console.log("   Station staff can scan it, use a physical reader, paste it, or search the queue.");
  console.log("");
  console.log("4) Station pages (the server verifies the active assignment)");
  for (const [, slug] of stations) {
    console.log(`   ${origin}/events/${event.eventId}/stations/${slug}?registrationId=${registration.registrationId}`);
  }
  console.log("");
  console.log("5) Scan-ready QR page (render + scan with a phone)");
  console.log(`   ${apiOrigin}/qr/dev-page/${registration.registrationId}`);
  console.log("");
  console.log("Note: phone scanning needs a LAN-visible origin. Set");
  console.log("PUBLIC_APP_ORIGIN=https://<your-pc-lan-ip>:5173 in backend/.env");
  console.log("and run the backend with HOST=0.0.0.0 to reach it from a phone.");
  console.log("Otherwise test on the same machine: decode the QR with a reader");
  console.log("or copy/paste the status URL directly into the browser.");
}

main()
  .catch((error) => {
    console.error("Preset failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
