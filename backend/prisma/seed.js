require("dotenv").config();
const bcrypt = require("bcrypt");
const prisma = require("./prismaClient");

const DEMO_PASSWORD = process.env.VSMS_DEMO_PASSWORD || "Demo-Only-Change-Me-2026!";
if (process.env.NODE_ENV === "production" && !process.env.VSMS_DEMO_PASSWORD) {
  throw new Error("VSMS_DEMO_PASSWORD is required for production seed execution");
}

const USERS = [
  { id: "10000000-0000-4000-8000-000000000001", username: "avery.chen", fullName: "Avery Chen", employeeNumber: "EMP001", email: "admin@vsms.local", sysRole: "ADMIN" },
  { id: "10000000-0000-4000-8000-000000000002", username: "maya.patel", fullName: "Maya Patel", employeeNumber: "EMP002", email: "manager@vsms.local", sysRole: "EVENT_MANAGER" },
  { id: "10000000-0000-4000-8000-000000000003", username: "jordan.lee", fullName: "Jordan Lee", employeeNumber: "EMP003", email: "staff@vsms.local", sysRole: "STAFF" },
  { id: "10000000-0000-4000-8000-000000000004", username: "samira.tan", fullName: "Dr Samira Tan", employeeNumber: "EMP004", email: "reviewer@vsms.local", sysRole: "STAFF" },
];

const STATION_TEMPLATES = [
  { stationTemplateId: "60000000-0000-4000-8000-000000000001", templateKey: "REGISTRATION", version: 1, name: "Registration", description: "Confirm the participant record, consent, and QR pass.", defaultCapacity: 3 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000002", templateKey: "VISUAL_ACUITY", version: 1, name: "Visual acuity", description: "Capture controlled distance and near-vision measurements.", defaultCapacity: 4 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000003", templateKey: "EYE_HEALTH", version: 1, name: "Eye health", description: "Record eye-health observations and screening flags.", defaultCapacity: 2 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000004", templateKey: "CLINICAL_REVIEW", version: 1, name: "Clinical review", description: "Review screening outcomes and decide the safe next step.", defaultCapacity: 2 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000005", templateKey: "REFRACTION", version: 1, name: "Refraction", description: "Capture objective refraction screening measurements.", defaultCapacity: 3 },
  { stationTemplateId: "60000000-0000-4000-8000-000000000006", templateKey: "COLOUR_VISION", version: 1, name: "Colour vision", description: "Record colour-vision screening observations.", defaultCapacity: 3 },
];

const SCREENING_STATIONS = [
  { stationName: "Visual Acuity", stationType: "VISUAL_ACUITY", stationOrder: 1, capacity: 4 },
  { stationName: "Refraction", stationType: "REFRACTION", stationOrder: 2, capacity: 3 },
  { stationName: "Colour Vision", stationType: "COLOUR_VISION", stationOrder: 3, capacity: 3 },
  { stationName: "Eye Health", stationType: "EYE_HEALTH", stationOrder: 4, capacity: 2 },
];

const REVIEW_PARTICIPANTS = [
  { id: "70000000-0000-4000-8000-000000000001", registrationId: "80000000-0000-4000-8000-000000000001", nric: "S1234567A", nricMasked: "S****567A", firstName: "Priya", lastName: "Nair", dateOfBirth: "1968-04-12", gender: "F", queueNumber: 11 },
  { id: "70000000-0000-4000-8000-000000000002", registrationId: "80000000-0000-4000-8000-000000000002", nric: "S2345678B", nricMasked: "S****678B", firstName: "Marcus", lastName: "Lim", dateOfBirth: "1959-09-23", gender: "M", queueNumber: 12 },
  { id: "70000000-0000-4000-8000-000000000003", registrationId: "80000000-0000-4000-8000-000000000003", nric: "S3456789C", nricMasked: "S****789C", firstName: "Aisha", lastName: "Rahman", dateOfBirth: "1974-01-08", gender: "F", queueNumber: 13 },
  { id: "70000000-0000-4000-8000-000000000004", registrationId: "80000000-0000-4000-8000-000000000004", nric: "S4567890D", nricMasked: "S****890D", firstName: "Daniel", lastName: "Ong", dateOfBirth: "1982-11-17", gender: "M", queueNumber: 14 },
];

const EVENTS = [
  { eventId: "20000000-0000-4000-8000-000000000001", name: "Northside Community Screening", venue: "Northside Community Hall", startsAt: "2026-08-12T00:00:00.000Z", endsAt: "2026-08-12T08:00:00.000Z", capacity: 180, status: "PUBLISHED" },
  { eventId: "20000000-0000-4000-8000-000000000002", name: "Riverside Vision Day", venue: "Riverside Civic Centre", startsAt: "2026-09-05T01:00:00.000Z", endsAt: "2026-09-05T07:00:00.000Z", capacity: 120, status: "DRAFT" },
  { eventId: "20000000-0000-4000-8000-000000000003", name: "Central Library Screening", venue: "Central Library Atrium", startsAt: "2026-07-22T01:00:00.000Z", endsAt: "2026-07-22T09:00:00.000Z", capacity: 200, status: "IN_PROGRESS" },
  { eventId: "20000000-0000-4000-8000-000000000004", name: "West End Community Check", venue: "West End Activity Centre", startsAt: "2026-06-18T00:00:00.000Z", endsAt: "2026-06-18T07:00:00.000Z", capacity: 150, status: "COMPLETED" },
  { eventId: "20000000-0000-4000-8000-000000000005", name: "Harbour Family Screening", venue: "Harbour Community Room", startsAt: "2026-08-20T00:00:00.000Z", endsAt: "2026-08-20T06:00:00.000Z", capacity: 100, status: "CANCELLED" },
];

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

    await prisma.station.updateMany({
      where: { eventId: stored.eventId },
      data: { stationOrder: { increment: 100 }, isActive: false },
    });
    for (const stationInput of SCREENING_STATIONS) {
      const station = await prisma.station.upsert({
        where: { eventId_stationType: { eventId: stored.eventId, stationType: stationInput.stationType } },
        update: {
          stationName: stationInput.stationName,
          stationOrder: stationInput.stationOrder,
          isActive: true
        },
        create: {
          eventId: stored.eventId,
          stationName: stationInput.stationName,
          stationType: stationInput.stationType,
          stationOrder: stationInput.stationOrder,
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
          capacity: stationInput.capacity
        },
        create: {
          eventStationId: station.stationId,
          eventDayId: eventDay.eventDayId,
          isAvailable: true,
          startsAt: eventDay.startsAt,
          endsAt: eventDay.endsAt,
          capacity: stationInput.capacity,
        },
      });
    }

    const shift = await prisma.shift.findFirstOrThrow({ where: { eventId: stored.eventId }, orderBy: { startsAt: "asc" } });
    await prisma.shift.update({
      where: { shiftId: shift.shiftId },
      data: { status: event.status === "COMPLETED" ? "COMPLETED" : event.status === "IN_PROGRESS" ? "ACTIVE" : event.status === "CANCELLED" ? "CANCELLED" : "PLANNED" },
    });
    const staffStation = await prisma.station.findFirstOrThrow({
      where: { eventId: stored.eventId, stationType: "VISUAL_ACUITY" },
    });

    const assignmentStatus = event.status === "COMPLETED" ? "COMPLETED" : event.status === "CANCELLED" ? "CANCELLED" : event.status === "IN_PROGRESS" ? "CONFIRMED" : "ASSIGNED";
    await prisma.staffAssignment.upsert({
      where: { eventId_userId_shiftId_stationId: { eventId: stored.eventId, userId: USERS[2].id, shiftId: shift.shiftId, stationId: staffStation.stationId } },
      update: { assignmentRole: "SCREENER", assignedBy: USERS[1].id, status: assignmentStatus, assignmentStatus },
      create: {
        eventId: stored.eventId,
        shiftId: shift.shiftId,
        userId: USERS[2].id,
        stationId: staffStation.stationId,
        assignmentRole: "SCREENER",
        assignedBy: USERS[1].id,
        status: assignmentStatus,
        assignmentStatus,
      },
    });

    if (event.status === "IN_PROGRESS") {
      const reviewerAssignment = await prisma.staffAssignment.findFirst({
        where: { eventId: stored.eventId, shiftId: shift.shiftId, userId: USERS[3].id, assignmentRole: "REVIEWER" },
      });
      const reviewerData = {
        eventId: stored.eventId,
        shiftId: shift.shiftId,
        stationId: null,
        userId: USERS[3].id,
        assignmentRole: "REVIEWER",
        assignedBy: USERS[1].id,
        status: "CONFIRMED",
        assignmentStatus: "CONFIRMED",
      };
      if (reviewerAssignment) await prisma.staffAssignment.update({ where: { id: reviewerAssignment.id }, data: reviewerData });
      else await prisma.staffAssignment.create({ data: reviewerData });
    }

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

  const reviewEventId = EVENTS.find((event) => event.status === "IN_PROGRESS").eventId;
  for (const participant of REVIEW_PARTICIPANTS) {
    await prisma.participant.upsert({
      where: { id: participant.id },
      update: {
        nric: participant.nric,
        nricMasked: participant.nricMasked,
        firstName: participant.firstName,
        lastName: participant.lastName,
        dateOfBirth: new Date(`${participant.dateOfBirth}T00:00:00.000Z`),
        gender: participant.gender,
        contactNumber: "+65 6000 0000",
        emergencyContact: "+65 6000 0001",
        consentGiven: true,
      },
      create: {
        id: participant.id,
        nric: participant.nric,
        nricMasked: participant.nricMasked,
        firstName: participant.firstName,
        lastName: participant.lastName,
        dateOfBirth: new Date(`${participant.dateOfBirth}T00:00:00.000Z`),
        gender: participant.gender,
        contactNumber: "+65 6000 0000",
        emergencyContact: "+65 6000 0001",
        consentGiven: true,
      },
    });
    await prisma.eventRegistration.upsert({
      where: { registrationId: participant.registrationId },
      update: {
        eventId: reviewEventId,
        participantId: participant.id,
        registeredBy: USERS[1].id,
        registrationStatus: "CHECKED_IN",
        participantDisplayName: `${participant.firstName} ${participant.lastName}`,
        queueNumber: participant.queueNumber,
        checkedIn: true,
      },
      create: {
        registrationId: participant.registrationId,
        eventId: reviewEventId,
        participantId: participant.id,
        registeredBy: USERS[1].id,
        registrationStatus: "CHECKED_IN",
        participantDisplayName: `${participant.firstName} ${participant.lastName}`,
        queueNumber: participant.queueNumber,
        checkedIn: true,
      },
    });
  }

  const registrationIds = REVIEW_PARTICIPANTS.map((participant) => participant.registrationId);
  await prisma.referral.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.review.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.screeningResult.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.auditLog.deleteMany({ where: { action: { in: ["CLINICAL_REVIEW_RECORDED", "REFERRAL_DRAFT_CREATED"] } } });

  const stations = await prisma.station.findMany({ where: { eventId: reviewEventId, isActive: true } });
  const stationByType = new Map(stations.map((station) => [station.stationType, station]));
  const makeResult = (registrationIndex, stationType, overallFlag, resultData, flagSummary = null) => {
    const station = stationByType.get(stationType);
    return {
      resultId: `90000000-0000-4000-8${registrationIndex}00-${String(station.stationOrder).padStart(12, "0")}`,
      registrationId: REVIEW_PARTICIPANTS[registrationIndex].registrationId,
      stationId: station.stationId,
      recordedByUserId: USERS[2].id,
      screeningType: stationType,
      resultData,
      overallFlag,
      isFlagged: overallFlag !== "NORMAL",
      flagSummary,
      ruleVersion: `DEMO-${stationType}-1.0`.slice(0, 20),
      acknowledgedAt: overallFlag === "NORMAL" ? null : new Date("2026-07-22T05:30:00.000Z"),
      idempotencyKey: `demo-review-${registrationIndex}-${stationType.toLowerCase()}`,
    };
  };
  const normalData = {
    VISUAL_ACUITY: { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 6 }, os: { kind: "FRACTION", denominator: 6 }, withUsualDistanceGlasses: false },
    REFRACTION: { sphericalEquivalentOd: -0.5, sphericalEquivalentOs: -0.25 },
    COLOUR_VISION: { platesCorrect: 14, platesAttempted: 14 },
    EYE_HEALTH: { observation: "No abnormality observed" },
  };
  const seededResults = SCREENING_STATIONS.map(({ stationType }) => makeResult(0, stationType, "NORMAL", normalData[stationType]));
  seededResults.push(...SCREENING_STATIONS.map(({ stationType }) => {
    if (stationType === "EYE_HEALTH") return makeResult(1, stationType, "REFER", { observation: "Possible lens opacity" }, "Possible lens opacity warrants referral");
    if (stationType === "VISUAL_ACUITY") return makeResult(1, stationType, "REVIEW", { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 18 }, os: { kind: "FRACTION", denominator: 12 }, withUsualDistanceGlasses: true }, "Reduced right-eye visual acuity");
    return makeResult(1, stationType, "NORMAL", normalData[stationType]);
  }));
  seededResults.push(makeResult(2, "EYE_HEALTH", "URGENT", { observation: "Sudden painful vision loss reported" }, "Urgent same-day assessment recommended"));
  seededResults.push(makeResult(3, "VISUAL_ACUITY", "REVIEW", { chartDistanceMetres: 6, od: { kind: "FRACTION", denominator: 18 }, os: { kind: "FRACTION", denominator: 12 }, withUsualDistanceGlasses: false }, "Reduced visual acuity requires review after remaining stations"));
  await prisma.screeningResult.createMany({ data: seededResults });

  console.log(JSON.stringify({
    success: true,
    message: "Database successfully seeded!",
    reviewerCredentials: { identifier: "reviewer@vsms.local", password: DEMO_PASSWORD },
  }, null, 2));
};

main().finally(() => prisma.$disconnect());
