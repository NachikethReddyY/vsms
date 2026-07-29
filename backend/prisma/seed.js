require("dotenv").config();
const bcrypt = require("bcrypt");
const prisma = require("./prismaClient");
const { encrypt, lookupHash } = require("../utils/cryptoUtils");

const DEMO_PASSWORD = process.env.VSMS_DEMO_PASSWORD || "Demo-Only-Change-Me-2026!";
if (process.env.NODE_ENV === "production" && !process.env.VSMS_DEMO_PASSWORD) {
  throw new Error("VSMS_DEMO_PASSWORD is required for production seed execution");
}

const USERS = [
  { id: "10000000-0000-4000-8000-000000000001", username: "avery.chen", fullName: "Avery Chen", employeeNumber: "EMP001", email: "admin@vsms.local", sysRole: "ADMIN" },
  { id: "10000000-0000-4000-8000-000000000002", username: "maya.patel", fullName: "Maya Patel", employeeNumber: "EMP002", email: "manager@vsms.local", sysRole: "EVENT_MANAGER" },
  { id: "10000000-0000-4000-8000-000000000003", username: "jordan.lee", fullName: "Jordan Lee", employeeNumber: "EMP003", email: "staff@vsms.local", sysRole: "STAFF" },
];

const STATION_TEMPLATES = [
  { stationTemplateId: "60000000-0000-4000-8000-000000000001", templateKey: "REGISTRATION", version: 1, name: "Registration", description: "Confirm the participant record, consent, and QR pass.", defaultCapacity: 3 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000002", templateKey: "VISUAL_ACUITY", version: 1, name: "Visual acuity", description: "Capture controlled distance and near-vision measurements.", defaultCapacity: 4 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000003", templateKey: "EYE_HEALTH", version: 1, name: "Eye health", description: "Record eye-health observations and screening flags.", defaultCapacity: 2 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000004", templateKey: "CLINICAL_REVIEW", version: 1, name: "Clinical review", description: "Review screening outcomes and decide the safe next step.", defaultCapacity: 2 },
];

const EVENTS = [
  { eventId: "20000000-0000-4000-8000-000000000001", name: "Northside Community Screening", venue: "Northside Community Hall", startsAt: "2026-08-12T00:00:00.000Z", endsAt: "2026-08-12T08:00:00.000Z", capacity: 180, status: "PUBLISHED" },
  { eventId: "20000000-0000-4000-8000-000000000002", name: "Riverside Vision Day", venue: "Riverside Civic Centre", startsAt: "2026-09-05T01:00:00.000Z", endsAt: "2026-09-05T07:00:00.000Z", capacity: 120, status: "DRAFT" },
  { eventId: "20000000-0000-4000-8000-000000000003", name: "Central Library Screening", venue: "Central Library Atrium", startsAt: "2026-07-22T01:00:00.000Z", endsAt: "2026-07-22T09:00:00.000Z", capacity: 200, status: "IN_PROGRESS" },
  { eventId: "20000000-0000-4000-8000-000000000004", name: "West End Community Check", venue: "West End Activity Centre", startsAt: "2026-06-18T00:00:00.000Z", endsAt: "2026-06-18T07:00:00.000Z", capacity: 150, status: "COMPLETED" },
  { eventId: "20000000-0000-4000-8000-000000000005", name: "Harbour Family Screening", venue: "Harbour Community Room", startsAt: "2026-08-20T00:00:00.000Z", endsAt: "2026-08-20T06:00:00.000Z", capacity: 100, status: "CANCELLED" },
];

// Fictional demo records only. They use non-real identifiers and phone numbers.
const PARTICIPANTS = [
  { id: "50000000-0000-4000-8000-000000000001", nric: "T0000001A", firstName: "Aisha", lastName: "Rahman", dateOfBirth: "1985-04-16", gender: "F", race: "Malay", contactNumber: "+6500000001", emergencyContact: "+6500000101", emergencyContactName: "Demo Contact", consentGiven: true },
  { id: "50000000-0000-4000-8000-000000000002", nric: "T0000002B", firstName: "Daniel", lastName: "Tan", dateOfBirth: "1978-11-03", gender: "M", race: "Chinese", contactNumber: "+6500000002", emergencyContact: "+6500000102", emergencyContactName: "Demo Contact", consentGiven: true },
  { id: "50000000-0000-4000-8000-000000000003", nric: "T0000003C", firstName: "Mei", lastName: "Ling", dateOfBirth: "1992-07-22", gender: "F", race: "Chinese", contactNumber: "+6500000003", emergencyContact: "+6500000103", emergencyContactName: "Demo Contact", consentGiven: true },
  { id: "50000000-0000-4000-8000-000000000004", nric: "T0000004D", firstName: "Kumar", lastName: "Nair", dateOfBirth: "1969-02-09", gender: "M", race: "Indian", contactNumber: "+6500000004", emergencyContact: "+6500000104", emergencyContactName: "Demo Contact", consentGiven: false },
  { id: "50000000-0000-4000-8000-000000000005", nric: "T0000005E", firstName: "Sofia", lastName: "Lim", dateOfBirth: "2001-09-28", gender: "F", race: "Chinese", contactNumber: "+6500000005", emergencyContact: "+6500000105", emergencyContactName: "Demo Contact", consentGiven: true },
  { id: "50000000-0000-4000-8000-000000000006", nric: "T0000006F", firstName: "Noah", lastName: "Wong", dateOfBirth: "1958-12-14", gender: "M", race: "Chinese", contactNumber: "+6500000006", emergencyContact: "+6500000106", emergencyContactName: "Demo Contact", consentGiven: true },
];

const PARTICIPANT_REGISTRATIONS = [
  { eventId: EVENTS[0].eventId, participantId: PARTICIPANTS[0].id, registrationStatus: "SIGNED_UP", checkedIn: false, queueNumber: 12 },
  { eventId: EVENTS[0].eventId, participantId: PARTICIPANTS[1].id, registrationStatus: "CHECKED_IN", checkedIn: true, queueNumber: 7 },
  { eventId: EVENTS[0].eventId, participantId: PARTICIPANTS[2].id, registrationStatus: "SIGNED_UP", checkedIn: false, queueNumber: 18 },
  { eventId: EVENTS[3].eventId, participantId: PARTICIPANTS[0].id, registrationStatus: "COMPLETED", checkedIn: true, queueNumber: 4 },
  { eventId: EVENTS[3].eventId, participantId: PARTICIPANTS[3].id, registrationStatus: "COMPLETED", checkedIn: true, queueNumber: 16 },
  { eventId: EVENTS[1].eventId, participantId: PARTICIPANTS[5].id, registrationStatus: "SIGNED_UP", checkedIn: false, queueNumber: 9 },
];

const maskNric = (nric) => `${nric.slice(0, 1)}XXXX${nric.slice(-3)}`;

const main = async () => {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { 
        username: user.username, 
        fullName: user.fullName, 
        employeeNumber: user.employeeNumber, 
        sysRole: user.sysRole, 
        status: "ACTIVE",
        credential: {
          update: { passwordHash }
        }
      },
      create: { 
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        employeeNumber: user.employeeNumber,
        email: user.email,
        sysRole: user.sysRole,
        status: "ACTIVE",
        credential: {
          create: { passwordHash }
        }
      },
    });
  }

  for (const template of STATION_TEMPLATES) {
    await prisma.stationTemplate.upsert({
      where: { stationTemplateId: template.stationTemplateId },
      update: { ...template, active: true },
      create: template,
    });
  }

  for (const participant of PARTICIPANTS) {
    const normalizedNric = participant.nric.toUpperCase();
    const data = {
      nric: encrypt(normalizedNric),
      nricLookupHash: lookupHash(normalizedNric),
      nricMasked: maskNric(normalizedNric),
      firstName: participant.firstName,
      lastName: participant.lastName,
      dateOfBirth: new Date(`${participant.dateOfBirth}T00:00:00.000Z`),
      gender: participant.gender,
      race: participant.race,
      nationality: "Singaporean",
      addressStreet: "Demo Street",
      addressUnit: "#00-00",
      addressPostalCode: "000000",
      contactNumber: participant.contactNumber,
      emergencyContact: participant.emergencyContact,
      emergencyContactName: participant.emergencyContactName,
      consentGiven: participant.consentGiven,
    };

    await prisma.participant.upsert({
      where: { id: participant.id },
      update: data,
      create: { id: participant.id, ...data },
    });
  }

  for (const [index, event] of EVENTS.entries()) {
    const cancelled = event.status === "CANCELLED";
    const data = {
      ...event,
      description: "Seeded demonstration event for the lifecycle flow.",
      timezone: "Asia/Singapore",
      expectedAttendance: event.capacity * 10,
      locationProvider: "MANUAL",
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
      createdByUserId: USERS[1].id,
      cancelledByUserId: cancelled ? USERS[0].id : null,
      cancelledAt: cancelled ? new Date("2026-07-20T04:00:00.000Z") : null,
      cancellationReason: cancelled ? "Venue became unavailable and requires rescheduling." : null,
    };
    const stored = await prisma.event.upsert({
      where: { eventId: event.eventId },
      update: data,
      create: {
        ...data,
        shifts: {
          create: [
            {
              name: "Morning operations",
              startsAt: new Date(event.startsAt),
              endsAt: new Date(new Date(event.startsAt).getTime() + 4 * 3600000),
              requiredStaff: 8,
              status: event.status === "COMPLETED" ? "COMPLETED" : event.status === "IN_PROGRESS" ? "ACTIVE" : event.status === "CANCELLED" ? "CANCELLED" : "PLANNED",
            },
          ],
        },
      },
    });
    const localDate = new Date(event.startsAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Singapore" });
    const eventDay = await prisma.eventDay.upsert({
      where: { eventId_date: { eventId: stored.eventId, date: new Date(`${localDate}T00:00:00.000Z`) } },
      update: { startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) },
      create: {
        eventId: stored.eventId,
        date: new Date(`${localDate}T00:00:00.000Z`),
        startsAt: new Date(event.startsAt),
        endsAt: new Date(event.endsAt),
      },
    });

    for (const [stationIndex, template] of STATION_TEMPLATES.entries()) {
      const mappedType = template.templateKey === "REGISTRATION" ? "VISUAL_ACUITY" 
                       : template.templateKey === "VISUAL_ACUITY" ? "VISUAL_ACUITY"
                       : template.templateKey === "EYE_HEALTH" ? "EYE_HEALTH"
                       : "REFRACTION";

      const station = await prisma.station.upsert({
        where: { eventId_stationType: { eventId: stored.eventId, stationType: mappedType } },
        update: {
          stationName: template.name,
          stationOrder: stationIndex + 1,
          isActive: true
        },
        create: {
          eventId: stored.eventId,
          stationName: template.name,
          stationType: mappedType,
          stationOrder: stationIndex + 1,
          isActive: true,
        },
      });

      await prisma.eventStationAvailability.upsert({
        where: { 
          eventStationId_eventDayId: { 
            eventStationId: station.stationId, 
            eventDayId: eventDay.eventDayId 
          } 
        },
        update: { 
          isAvailable: true, 
          startsAt: eventDay.startsAt, 
          endsAt: eventDay.endsAt, 
          capacity: template.defaultCapacity 
        },
        create: {
          eventStationId: station.stationId,
          eventDayId: eventDay.eventDayId,
          isAvailable: true,
          startsAt: eventDay.startsAt,
          endsAt: eventDay.endsAt,
          capacity: template.defaultCapacity,
        },
      });
    }

    const shift = await prisma.shift.findFirstOrThrow({ where: { eventId: stored.eventId }, orderBy: { startsAt: "asc" } });
    const staffStation = await prisma.station.findFirstOrThrow({
      where: { eventId: stored.eventId, stationType: "VISUAL_ACUITY" },
    });

    const assignmentStatus = event.status === "COMPLETED" ? "COMPLETED" : event.status === "CANCELLED" ? "CANCELLED" : event.status === "IN_PROGRESS" ? "CONFIRMED" : "ASSIGNED";
    await prisma.staffAssignment.upsert({
      where: { eventId_userId_shiftId_stationId: { eventId: stored.eventId, userId: USERS[2].id, shiftId: shift.shiftId, stationId: staffStation.stationId } },
      update: { assignmentRole: "SCREENER", assignedBy: USERS[1].id, status: assignmentStatus },
      create: {
        eventId: stored.eventId,
        shiftId: shift.shiftId,
        userId: USERS[2].id,
        stationId: staffStation.stationId,
        assignmentRole: "SCREENER",
        assignedBy: USERS[1].id,
        status: assignmentStatus,
      },
    });

    const auditId = `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    if (!await prisma.eventAuditLog.findUnique({ where: { eventAuditLogId: auditId } })) {
      await prisma.eventAuditLog.create({
        data: {
          eventAuditLogId: auditId,
          eventId: stored.eventId,
          actorUserId: USERS[1].id,
          action: "CREATED",
          correlationId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          afterSnapshot: { name: stored.name, status: stored.status, capacity: stored.capacity, version: stored.version },
        },
      });
    }
  }

  for (const registration of PARTICIPANT_REGISTRATIONS) {
    const participant = PARTICIPANTS.find((item) => item.id === registration.participantId);
    const data = {
      registeredBy: USERS[1].id,
      registrationStatus: registration.registrationStatus,
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber: registration.queueNumber,
      checkedIn: registration.checkedIn,
    };

    await prisma.eventRegistration.upsert({
      where: { eventId_participantId: { eventId: registration.eventId, participantId: registration.participantId } },
      update: data,
      create: { eventId: registration.eventId, participantId: registration.participantId, ...data },
    });
  }

  console.log(JSON.stringify({
    success: true,
    message: "Database successfully seeded!",
    participants: PARTICIPANTS.length,
    registrations: PARTICIPANT_REGISTRATIONS.length,
  }, null, 2));
};

main().finally(() => prisma.$disconnect());
