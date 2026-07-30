const crypto = require("crypto");
require("dotenv").config();
const prisma = require("./prismaClient");

const roleDefinitions = [
  ["ADMINISTRATOR", "Full administrative access", 1],
  ["EVENT_MANAGER", "Creates and manages events", 2],
  ["REGISTRATION_OFFICER", "Registers participants and records consent", 3],
  ["SCREENER", "Performs participant screening", 4],
  ["REVIEWER", "Reviews screening outcomes", 5],
];

const permissionNames = [
  "participants:read",
  "participants:write",
  "consents:record",
  "registrations:create",
  "registrations:read",
  "audit:read",
];

const stationTemplates = [
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000001",
    templateKey: "REGISTRATION",
    version: 1,
    name: "Registration",
    description: "Confirm the participant record, consent, and QR pass.",
    defaultCapacity: 3,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000002",
    templateKey: "VISUAL_ACUITY",
    version: 1,
    name: "Visual acuity",
    description: "Capture controlled distance and near-vision measurements.",
    defaultCapacity: 4,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000003",
    templateKey: "EYE_HEALTH",
    version: 1,
    name: "Eye health",
    description: "Record eye-health observations and screening flags.",
    defaultCapacity: 2,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000004",
    templateKey: "CLINICAL_REVIEW",
    version: 1,
    name: "Clinical review",
    description: "Review screening outcomes and decide the safe next step.",
    defaultCapacity: 2,
  },
];

async function seedRoles() {
  const roles = new Map();
  for (const [roleName, description, precedence] of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { roleName },
      update: { description, precedence },
      create: { roleName, description, precedence },
    });
    roles.set(roleName, role);
  }
  return roles;
}

async function seedStaff(roles) {
  const email = String(process.env.SEED_STAFF_EMAIL || "seed.admin@cryptix.local").trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", sysRole: "ADMIN" },
    create: {
      username: email,
      fullName: process.env.SEED_STAFF_NAME || "Seed Administrator",
      email,
      employeeNumber: process.env.SEED_STAFF_EMPLOYEE_NUMBER || "SEED-ADMIN-001",
      department: "Operations",
      designation: "Registration Officer",
      status: "ACTIVE",
      sysRole: "ADMIN",
    },
  });

  for (const roleName of ["ADMINISTRATOR", "REGISTRATION_OFFICER"]) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: roles.get(roleName).id } },
      update: {},
      create: { userId: user.id, roleId: roles.get(roleName).id },
    });
  }
  return user;
}

async function seedReviewer(roles, staff) {
  const email = String(process.env.SEED_REVIEWER_EMAIL || "reviewer@vsms.local").trim().toLowerCase();
  const reviewer = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", sysRole: "STAFF" },
    create: {
      username: email,
      fullName: process.env.SEED_REVIEWER_NAME || "Dr Samira Tan",
      email,
      employeeNumber: process.env.SEED_REVIEWER_EMPLOYEE_NUMBER || "SEED-REVIEWER-001",
      department: "Clinical Operations",
      designation: "Clinical Reviewer",
      status: "ACTIVE",
      sysRole: "STAFF",
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: reviewer.id, roleId: roles.get("REVIEWER").id } },
    update: { assignedById: staff.id },
    create: { userId: reviewer.id, roleId: roles.get("REVIEWER").id, assignedById: staff.id },
  });
  return reviewer;
}

async function seedPermissions(roles, staff) {
  const permissions = new Map();
  for (const permissionName of permissionNames) {
    const permission = await prisma.permission.upsert({
      where: { permissionName },
      update: {},
      create: {
        permissionName,
        description: `Allows ${permissionName}`,
        createdById: staff.id,
      },
    });
    permissions.set(permissionName, permission);
  }

  for (const roleName of ["ADMINISTRATOR", "REGISTRATION_OFFICER"]) {
    const allowed = roleName === "ADMINISTRATOR"
      ? permissionNames
      : permissionNames.filter((name) => name !== "audit:read");
    for (const permissionName of allowed) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roles.get(roleName).id,
            permissionId: permissions.get(permissionName).id,
          },
        },
        update: {},
        create: {
          roleId: roles.get(roleName).id,
          permissionId: permissions.get(permissionName).id,
        },
      });
    }
  }
}

async function seedStationTemplates() {
  for (const template of stationTemplates) {
    await prisma.stationTemplate.upsert({
      where: { stationTemplateId: template.stationTemplateId },
      update: { ...template, active: true },
      create: template,
    });
  }
}

async function seedConsentForm(staff) {
  const contentText = [
    "I confirm that the screening process, use of my information, potential risks,",
    "privacy safeguards, and my right to decline or withdraw have been explained to me.",
    "I voluntarily consent to participate in this event screening.",
  ].join(" ");
  return prisma.consentFormVersion.upsert({
    where: {
      formCode_versionNumber: {
        formCode: "VSMS-CONSENT",
        versionNumber: "1.0",
      },
    },
    update: { isActive: true, contentText },
    create: {
      formCode: "VSMS-CONSENT",
      versionNumber: "1.0",
      title: "Participant Screening Consent",
      contentText,
      contentHash: crypto.createHash("sha256").update(contentText).digest("hex"),
      documentObjectKey: "consent-forms/VSMS-CONSENT/1.0",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      isActive: true,
      createdById: staff.id,
    },
  });
}

function demoDate(dayOffset, hour, minute = 0) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  value.setUTCHours(hour, minute, 0, 0);
  return value;
}

async function upsertDemoEvent(staff, {
  key,
  name,
  venue,
  status,
  startsAt,
  endsAt,
  capacity,
}) {
  return prisma.event.upsert({
    where: {
      createdByUserId_createIdempotencyKey: {
        createdByUserId: staff.id,
        createIdempotencyKey: key,
      },
    },
    update: {
      name,
      venue,
      status,
      startsAt,
      endsAt,
      capacity,
      expectedAttendance: Math.floor(capacity * 0.75),
    },
    create: {
      name,
      description: "Demonstration event for testing participant registration, consent, check-in, and QR workflows.",
      bannerKey: "COMMUNITY_SCREENING",
      venue,
      address: venue,
      postalCode: "529536",
      timezone: "Asia/Singapore",
      startsAt,
      endsAt,
      capacity,
      expectedAttendance: Math.floor(capacity * 0.75),
      status,
      createdByUserId: staff.id,
      createIdempotencyKey: key,
      createPayloadHash: crypto.createHash("sha256").update(key).digest("hex"),
    },
  });
}

async function seedEventStructure(event, staff) {
  const shiftStartsAt = event.startsAt;
  const shiftEndsAt = event.endsAt;
  const existingShift = await prisma.shift.findFirst({
    where: { eventId: event.eventId, name: "Registration and screening" },
  });
  const shift = existingShift
    ? await prisma.shift.update({
        where: { shiftId: existingShift.shiftId },
        data: {
          startsAt: shiftStartsAt,
          endsAt: shiftEndsAt,
          requiredStaff: 3,
          status: event.status === "IN_PROGRESS" ? "ACTIVE" : event.status === "COMPLETED" ? "COMPLETED" : "PLANNED",
        },
      })
    : await prisma.shift.create({
        data: {
          eventId: event.eventId,
          name: "Registration and screening",
          startsAt: shiftStartsAt,
          endsAt: shiftEndsAt,
          requiredStaff: 3,
          status: event.status === "IN_PROGRESS" ? "ACTIVE" : event.status === "COMPLETED" ? "COMPLETED" : "PLANNED",
        },
      });

  const stationDefinitions = [
    ["VISUAL_ACUITY", "Visual acuity", 1],
    ["REFRACTION", "Refraction", 2],
  ];
  const stations = [];
  for (const [stationType, stationName, stationOrder] of stationDefinitions) {
    stations.push(await prisma.station.upsert({
      where: { eventId_stationType: { eventId: event.eventId, stationType } },
      update: { stationName, stationOrder, isActive: true },
      create: {
        eventId: event.eventId,
        stationType,
        stationName,
        stationOrder,
        isActive: true,
      },
    }));
  }

  const registrationOfficers = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { id: staff.id },
        { userRoles: { some: { role: { roleName: "REGISTRATION_OFFICER" } } } },
      ],
    },
    select: { id: true },
  });
  for (const officer of registrationOfficers) {
    const assignment = await prisma.staffAssignment.findFirst({
      where: {
        eventId: event.eventId,
        userId: officer.id,
        assignmentRole: "REGISTRATION",
        shiftId: null,
        stationId: null,
      },
    });
    if (assignment) {
      await prisma.staffAssignment.update({
        where: { id: assignment.id },
        data: { status: "ASSIGNED", assignmentStatus: "ASSIGNED", assignedBy: staff.id },
      });
    } else {
      await prisma.staffAssignment.create({
        data: {
          eventId: event.eventId,
          userId: officer.id,
          assignedBy: staff.id,
          assignmentRole: "REGISTRATION",
          assignmentStatus: "ASSIGNED",
          status: "ASSIGNED",
        },
      });
    }
  }

  return { shift, stations };
}

async function upsertDemoParticipant(staff, {
  participantReference,
  firstName,
  lastName,
  dateOfBirth,
  contactNumber,
  email,
  accessibilityNotes = null,
}) {
  return prisma.participant.upsert({
    where: { participantReference },
    update: {
      firstName,
      lastName,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
      contactNumber,
      email,
      accessibilityNotes,
      status: "ACTIVE",
      updatedById: staff.id,
    },
    create: {
      participantReference,
      firstName,
      lastName,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
      gender: "U",
      contactNumber,
      email,
      preferredLanguage: "English",
      accessibilityNotes,
      status: "ACTIVE",
      emergencyContact: contactNumber,
      consentGiven: false,
      createdById: staff.id,
      updatedById: staff.id,
    },
  });
}

async function ensureDemoContact(staff, participant, {
  contactName,
  relationship,
  phoneNumber,
  email,
}) {
  const existing = await prisma.participantEmergencyContact.findFirst({
    where: { participantId: participant.id, contactName },
  });
  const data = {
    contactName,
    relationship,
    phoneNumber,
    email,
    isPrimary: true,
    status: "ACTIVE",
    updatedById: staff.id,
  };
  if (existing) {
    return prisma.participantEmergencyContact.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.participantEmergencyContact.create({
    data: {
      ...data,
      participantId: participant.id,
      createdById: staff.id,
    },
  });
}

async function ensureAcceptedConsent(staff, participant, event, consentForm, signerName) {
  const existing = await prisma.participantConsent.findFirst({
    where: {
      participantId: participant.id,
      eventId: event.eventId,
      consentStatus: "ACCEPTED",
      withdrawalOfId: null,
    },
  });
  const signatureSha256 = crypto.createHash("sha256")
    .update(`${participant.participantReference}:${event.eventId}`)
    .digest("hex");
  const data = {
    consentFormVersionId: consentForm.id,
    consentStatus: "ACCEPTED",
    signerType: "PARTICIPANT",
    signerName,
    signatureObjectKey: `signatures/demo/${participant.participantReference}.png`,
    signatureSha256,
    signatureMimeType: "image/png",
    recordedById: staff.id,
    signedAt: new Date(),
    decisionAt: new Date(),
  };
  const consent = existing
    ? await prisma.participantConsent.update({ where: { id: existing.id }, data })
    : await prisma.participantConsent.create({
        data: {
          ...data,
          participantId: participant.id,
          eventId: event.eventId,
        },
      });
  await prisma.participant.update({
    where: { id: participant.id },
    data: { consentGiven: true, updatedById: staff.id },
  });
  return consent;
}

async function ensureDemoRegistration(staff, participant, event, consent) {
  const idempotencyKey = `seed-registration-${participant.participantReference}`;
  const registration = await prisma.eventRegistration.upsert({
    where: {
      participantId_eventId: {
        participantId: participant.id,
        eventId: event.eventId,
      },
    },
    update: {
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      passToken: "VSMS-DEMO-QR-001",
    },
    create: {
      participantId: participant.id,
      eventId: event.eventId,
      registeredBy: staff.id,
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber: 1,
      idempotencyKey,
      passToken: "VSMS-DEMO-QR-001",
    },
  });
  const history = await prisma.registrationStatusHistory.findFirst({
    where: { registrationId: registration.registrationId, toStatus: "SIGNED_UP" },
  });
  if (!history) {
    await prisma.registrationStatusHistory.create({
      data: {
        registrationId: registration.registrationId,
        fromStatus: null,
        toStatus: "SIGNED_UP",
        changedById: staff.id,
        reason: "Seeded demonstration registration",
      },
    });
  }
  await prisma.participantConsent.update({
    where: { id: consent.id },
    data: { registrationId: registration.registrationId },
  });

  const token = "VSMS-DEMO-QR-001";
  const qr = await prisma.qRCodePass.upsert({
    where: { token },
    update: {
      registrationId: registration.registrationId,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: demoDate(30, 23, 59),
      isActive: true,
      revokedAt: null,
      revokedBy: null,
      revokedReason: null,
    },
    create: {
      registrationId: registration.registrationId,
      token,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: demoDate(30, 23, 59),
      isActive: true,
    },
  });
  return { registration, qr };
}

async function seedDemoData(staff, reviewer, consentForm) {
  const upcomingEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-tampines",
    name: "Community Eye Screening - Tampines",
    venue: "Our Tampines Hub",
    status: "PUBLISHED",
    startsAt: demoDate(2, 1),
    endsAt: demoDate(2, 9),
    capacity: 120,
  });
  const liveEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-jurong-live",
    name: "Vision Screening - Jurong Live",
    venue: "Jurong Regional Library",
    status: "IN_PROGRESS",
    startsAt: demoDate(0, 0),
    endsAt: demoDate(0, 23),
    capacity: 80,
  });
  const completedEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-woodlands-complete",
    name: "Community Eye Screening - Woodlands",
    venue: "Woodlands Community Club",
    status: "COMPLETED",
    startsAt: demoDate(-14, 1),
    endsAt: demoDate(-14, 9),
    capacity: 100,
  });
  const [, liveStructure] = await Promise.all([
    seedEventStructure(upcomingEvent, staff),
    seedEventStructure(liveEvent, staff),
    seedEventStructure(completedEvent, staff),
  ]);

  const reviewerAssignment = await prisma.staffAssignment.findFirst({
    where: {
      eventId: liveEvent.eventId,
      shiftId: liveStructure.shift.shiftId,
      userId: reviewer.id,
      assignmentRole: "REVIEWER",
      stationId: null,
    },
  });
  const reviewerAssignmentData = {
    assignedBy: staff.id,
    assignmentStatus: "CONFIRMED",
    status: "CONFIRMED",
  };
  if (reviewerAssignment) {
    await prisma.staffAssignment.update({ where: { id: reviewerAssignment.id }, data: reviewerAssignmentData });
  } else {
    await prisma.staffAssignment.create({
      data: {
        ...reviewerAssignmentData,
        eventId: liveEvent.eventId,
        shiftId: liveStructure.shift.shiftId,
        userId: reviewer.id,
        assignmentRole: "REVIEWER",
      },
    });
  }

  const aisha = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000001",
    firstName: "Aisha",
    lastName: "Rahman",
    dateOfBirth: "1988-04-12",
    contactNumber: "+65 8123 4567",
    email: "aisha.rahman@example.test",
    accessibilityNotes: "Prefers large-print instructions.",
  });
  const daniel = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000002",
    firstName: "Daniel",
    lastName: "Tan",
    dateOfBirth: "1975-09-23",
    contactNumber: "+65 8234 5678",
    email: "daniel.tan@example.test",
  });
  const priya = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000003",
    firstName: "Priya",
    lastName: "Nair",
    dateOfBirth: "1992-02-18",
    contactNumber: "+65 8345 6789",
    email: "priya.nair@example.test",
  });
  const marcus = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000004",
    firstName: "Marcus",
    lastName: "Lim",
    dateOfBirth: "1983-11-05",
    contactNumber: "+65 8456 7890",
    email: "marcus.lim@example.test",
  });

  await ensureDemoContact(staff, aisha, {
    contactName: "Nur Rahman",
    relationship: "Sister",
    phoneNumber: "+65 9123 4001",
    email: "nur.rahman@example.test",
  });
  await ensureDemoContact(staff, daniel, {
    contactName: "Grace Tan",
    relationship: "Spouse",
    phoneNumber: "+65 9123 4002",
    email: "grace.tan@example.test",
  });
  await ensureDemoContact(staff, priya, {
    contactName: "Arun Nair",
    relationship: "Brother",
    phoneNumber: "+65 9123 4003",
    email: "arun.nair@example.test",
  });

  const aishaConsent = await ensureAcceptedConsent(
    staff,
    aisha,
    upcomingEvent,
    consentForm,
    "Aisha Rahman"
  );
  const danielConsent = await ensureAcceptedConsent(
    staff,
    daniel,
    liveEvent,
    consentForm,
    "Daniel Tan"
  );
  const { registration, qr } = await ensureDemoRegistration(
    staff,
    daniel,
    liveEvent,
    danielConsent
  );

  for (const station of liveStructure.stations) {
    const visualAcuity = station.stationType === "VISUAL_ACUITY";
    const result = {
      recordedByUserId: reviewer.id,
      screeningType: station.stationType,
      resultData: visualAcuity
        ? { od: { kind: "FRACTION", denominator: 18 }, os: { kind: "FRACTION", denominator: 24 }, chartDistanceMetres: 6, withUsualDistanceGlasses: true }
        : { sphericalEquivalentRight: -1.25, sphericalEquivalentLeft: -1.75, notes: "Review recommended" },
      overallFlag: visualAcuity ? "REFER" : "REVIEW",
      isFlagged: true,
      flagSummary: visualAcuity ? "Reduced visual acuity in both eyes" : "Refractive difference requires review",
      ruleVersion: "VSMS-SEED-1.0",
      idempotencyKey: `seed-review-${registration.registrationId.slice(0, 8)}-${station.stationId.slice(0, 8)}`,
    };
    await prisma.screeningResult.upsert({
      where: { registrationId_stationId: { registrationId: registration.registrationId, stationId: station.stationId } },
      update: result,
      create: { ...result, registrationId: registration.registrationId, stationId: station.stationId },
    });
  }

  return {
    events: { upcomingEvent, liveEvent, completedEvent },
    participants: { aisha, daniel, priya, marcus },
    aishaConsent,
    registration,
    qr,
  };
}

async function main() {
  const roles = await seedRoles();
  const staff = await seedStaff(roles);
  const reviewer = await seedReviewer(roles, staff);
  await seedPermissions(roles, staff);
  await seedStationTemplates();
  const consentForm = await seedConsentForm(staff);
  const demo = await seedDemoData(staff, reviewer, consentForm);
  console.log(`Seeded roles, permissions, station templates, consent form, staff profile, and demonstration data for ${staff.email}.`);
  console.log(`Upcoming event: ${demo.events.upcomingEvent.name} (${demo.events.upcomingEvent.eventId})`);
  console.log(`Live event: ${demo.events.liveEvent.name} (${demo.events.liveEvent.eventId})`);
  console.log(`Ready participant: ${demo.participants.aisha.participantReference} - Aisha Rahman`);
  console.log(`Needs consent: ${demo.participants.priya.participantReference} - Priya Nair`);
  console.log(`Needs emergency contact: ${demo.participants.marcus.participantReference} - Marcus Lim`);
  console.log(`Registered participant: ${demo.participants.daniel.participantReference} - Daniel Tan`);
  console.log(`Reviewer profile: ${reviewer.email} (Cognito group: REVIEWER)`);
  console.log(`Registration ID: ${demo.registration.registrationId}`);
  console.log(`Demo QR token: ${demo.qr.token}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
