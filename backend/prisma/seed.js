const crypto = require("crypto");
const bcrypt = require("bcrypt");
require("dotenv").config();
const prisma = require("./prismaClient");
const { encrypt, encryptionContext } = require("../utils/crypto/cryptoUtils");
const qrService = require("../services/participant/qrService");

if (process.env.NODE_ENV === "production") {
  throw new Error("Demo seed execution is forbidden in production");
}

const DEMO_PASSWORD = process.env.VSMS_DEMO_PASSWORD || "Demo-Only-Change-Me-2026!";

const DEMO_ANCHOR_DATE = process.env.VSMS_DEMO_ANCHOR_DATE || "2026-08-10";
if (!/^\d{4}-\d{2}-\d{2}$/.test(DEMO_ANCHOR_DATE) || Number.isNaN(Date.parse(`${DEMO_ANCHOR_DATE}T00:00:00.000Z`))) {
  throw new Error("VSMS_DEMO_ANCHOR_DATE must be an ISO date (YYYY-MM-DD)");
}
const DEMO_NOW = new Date(`${DEMO_ANCHOR_DATE}T00:00:00.000Z`);
const demoTimestamp = () => new Date(DEMO_NOW);

// Valid 64-char hex token (matches the QR_TOKEN_PATTERN used by manual check-in)
// so the seeded demo pass is demonstrable end-to-end.
const DEMO_QR_TOKEN = "ab".repeat(32);

const roleDefinitions = [
  ["ADMINISTRATOR", "Full administrative access", 1],
  ["EVENT_MANAGER", "Creates and manages events", 2],
  ["REGISTRATION_OFFICER", "Registers participants and manages event intake", 3],
  ["SCREENER", "Performs participant screening", 4],
  ["REVIEWER", "Reviews screening outcomes", 5],
  ["SUPPORT", "Supports event operations", 6],
];

const permissionNames = [
  "participants:read",
  "participants:write",
  "participants:cross-event-reuse",
  "registrations:create",
  "registrations:read",
  "audit:read",
];

const { SYSTEM_FIELD_SCHEMAS, CUSTOM_OD_NOTES_SCHEMA } = require("../schemas/dynamicStationSchema");

const stationTemplates = [
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000001",
    templateKey: "REGISTRATION",
    version: 1,
    name: "Registration",
    description: "Confirm the participant record and QR pass.",
    defaultCapacity: 3,
    fieldSchema: null,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000002",
    templateKey: "VISUAL_ACUITY",
    stationType: "VISUAL_ACUITY",
    version: 1,
    name: "Visual acuity",
    description: "Capture controlled distance and near-vision measurements.",
    defaultCapacity: 4,
    fieldSchema: SYSTEM_FIELD_SCHEMAS.VISUAL_ACUITY,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000003",
    templateKey: "EYE_HEALTH",
    version: 1,
    name: "Eye health",
    description: "Catalog reference for clinician review observations. Not a screener station — doctors record eye-health notes during clinical review from other station results.",
    defaultCapacity: 2,
    fieldSchema: null,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000004",
    templateKey: "CLINICAL_REVIEW",
    version: 1,
    name: "Clinical review",
    description: "Review screening outcomes and decide the safe next step.",
    defaultCapacity: 2,
    fieldSchema: null,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000005",
    templateKey: "REFRACTION",
    stationType: "REFRACTION",
    version: 1,
    name: "Refraction",
    description: "Capture autorefractor SPH/CYL/Axis readings for both eyes.",
    defaultCapacity: 3,
    fieldSchema: SYSTEM_FIELD_SCHEMAS.REFRACTION,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000006",
    templateKey: "COLOUR_VISION",
    stationType: "COLOUR_VISION",
    version: 1,
    name: "Colour vision",
    description: "Record Ishihara plate scores for each eye.",
    defaultCapacity: 3,
    fieldSchema: SYSTEM_FIELD_SCHEMAS.COLOUR_VISION,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000007",
    templateKey: "CUSTOM_OD_NOTES",
    stationType: "CUSTOM",
    version: 1,
    name: "OD-only notes",
    description: "Example customizable station: right-eye observations only.",
    defaultCapacity: 2,
    fieldSchema: CUSTOM_OD_NOTES_SCHEMA,
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

async function seedStaff(roles, passwordHash) {
  const email = String(process.env.SEED_STAFF_EMAIL || "synthetic.admin@example.test").trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", sysRole: "ADMIN", approvalState: "APPROVED", accessState: "ENABLED", deprovisionedAt: null },
    create: {
      username: email,
      fullName: process.env.SEED_STAFF_NAME || "Synthetic Administrator",
      email,
      employeeNumber: process.env.SEED_STAFF_EMPLOYEE_NUMBER || "SYNTH-ADMIN-001",
      department: "Operations",
      designation: "Event Administrator",
      status: "ACTIVE",
      sysRole: "ADMIN",
      approvalState: "APPROVED",
      accessState: "ENABLED",
    },
  });
  await prisma.userCredential.upsert({
    where: { userId: user.id },
    update: { passwordHash },
    create: { userId: user.id, passwordHash },
  });

  await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: { not: roles.get("ADMINISTRATOR").id } } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: roles.get("ADMINISTRATOR").id } },
    update: {},
    create: { userId: user.id, roleId: roles.get("ADMINISTRATOR").id },
  });
  return user;
}

async function seedRegistrationOfficer(roles, staff, passwordHash) {
  const email = String(process.env.SEED_REGISTRATION_EMAIL || "synthetic.registration@example.test").trim().toLowerCase();
  const officer = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", sysRole: "STAFF", approvalState: "APPROVED", accessState: "ENABLED", deprovisionedAt: null },
    create: {
      username: email,
      fullName: process.env.SEED_REGISTRATION_NAME || "Synthetic Registration Officer",
      email,
      employeeNumber: process.env.SEED_REGISTRATION_EMPLOYEE_NUMBER || "SYNTH-REG-001",
      department: "Event Operations",
      designation: "Registration Officer",
      status: "ACTIVE",
      sysRole: "STAFF",
      approvalState: "APPROVED",
      accessState: "ENABLED",
    },
  });
  await prisma.userCredential.upsert({
    where: { userId: officer.id },
    update: { passwordHash },
    create: { userId: officer.id, passwordHash },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: officer.id, roleId: roles.get("REGISTRATION_OFFICER").id } },
    update: { assignedById: staff.id },
    create: { userId: officer.id, roleId: roles.get("REGISTRATION_OFFICER").id, assignedById: staff.id },
  });
  return officer;
}

async function seedReviewer(roles, staff, passwordHash) {
  const email = String(process.env.SEED_REVIEWER_EMAIL || "synthetic.reviewer@example.test").trim().toLowerCase();
  const reviewer = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", sysRole: "STAFF", approvalState: "APPROVED", accessState: "ENABLED", deprovisionedAt: null },
    create: {
      username: email,
      fullName: process.env.SEED_REVIEWER_NAME || "Synthetic Reviewer",
      email,
      employeeNumber: process.env.SEED_REVIEWER_EMPLOYEE_NUMBER || "SYNTH-REVIEWER-001",
      department: "Clinical Operations",
      designation: "Clinical Reviewer",
      status: "ACTIVE",
      sysRole: "STAFF",
      approvalState: "APPROVED",
      accessState: "ENABLED",
    },
  });
  await prisma.userCredential.upsert({
    where: { userId: reviewer.id },
    update: { passwordHash },
    create: { userId: reviewer.id, passwordHash },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: reviewer.id, roleId: roles.get("REVIEWER").id } },
    update: { assignedById: staff.id },
    create: { userId: reviewer.id, roleId: roles.get("REVIEWER").id, assignedById: staff.id },
  });
  return reviewer;
}

async function seedScreener(roles, staff, passwordHash) {
  const email = String(process.env.SEED_SCREENER_EMAIL || "synthetic.screener@example.test").trim().toLowerCase();
  const screener = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", sysRole: "STAFF", approvalState: "APPROVED", accessState: "ENABLED", deprovisionedAt: null },
    create: {
      username: email,
      fullName: "Synthetic Visual Acuity Screener",
      email,
      employeeNumber: "SYNTH-SCREENER-001",
      department: "Clinical Operations",
      designation: "Visual Acuity Screener",
      status: "ACTIVE",
      sysRole: "STAFF",
      approvalState: "APPROVED",
      accessState: "ENABLED",
    },
  });
  await prisma.userCredential.upsert({
    where: { userId: screener.id },
    update: { passwordHash },
    create: { userId: screener.id, passwordHash },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: screener.id, roleId: roles.get("SCREENER").id } },
    update: { assignedById: staff.id },
    create: { userId: screener.id, roleId: roles.get("SCREENER").id, assignedById: staff.id },
  });
  return screener;
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
    const data = {
      ...template,
      stationType: template.stationType ?? null,
      active: true,
    };
    await prisma.stationTemplate.upsert({
      where: { stationTemplateId: template.stationTemplateId },
      update: data,
      create: data,
    });
  }
}

function demoDate(dayOffset, hour, minute = 0) {
  // Demo events are configured for Asia/Singapore. Derive the calendar date
  // there, then return the equivalent UTC instant for storage in PostgreSQL.
  const singaporeOffsetMs = 8 * 60 * 60 * 1000;
  const singaporeNow = new Date(DEMO_NOW.getTime() + singaporeOffsetMs);
  return new Date(Date.UTC(
    singaporeNow.getUTCFullYear(),
    singaporeNow.getUTCMonth(),
    singaporeNow.getUTCDate() + dayOffset,
    hour - 8,
    minute,
    0,
    0,
  ));
}

function singaporeToday(hour, minute = 0) {
  const singaporeOffsetMs = 8 * 60 * 60 * 1000;
  const singaporeNow = new Date(Date.now() + singaporeOffsetMs);
  return new Date(Date.UTC(
    singaporeNow.getUTCFullYear(),
    singaporeNow.getUTCMonth(),
    singaporeNow.getUTCDate(),
    hour - 8,
    minute,
    0,
    0,
  ));
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
      description: "Demonstration event for testing participant registration, check-in, and QR workflows.",
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

async function ensureDemoMembership(event, user, roles, staff) {
  const membership = await prisma.eventMembership.upsert({
    where: { eventId_userId: { eventId: event.eventId, userId: user.id } },
    update: { status: "ACTIVE", addedById: staff.id, removedById: null, removedAt: null, removalReason: null },
    create: { eventId: event.eventId, userId: user.id, addedById: staff.id },
  });
  for (const role of roles) {
    await prisma.eventMembershipRole.upsert({
      where: { membershipId_role: { membershipId: membership.id, role } },
      update: { assignedById: staff.id },
      create: { membershipId: membership.id, role, assignedById: staff.id },
    });
  }
  return membership;
}

async function seedEventStructure(event, staff, registrationOfficer) {
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
    ["COLOUR_VISION", "Colour vision", 3],
  ];
  const stations = [];
  for (const [stationType, stationName, stationOrder] of stationDefinitions) {
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
  // Eye health is clinician-review only — deactivate any leftover screener stations.
  await prisma.station.updateMany({
    where: { eventId: event.eventId, stationType: "EYE_HEALTH", isActive: true },
    data: { isActive: false },
  });


  await prisma.staffAssignment.deleteMany({
    where: { eventId: event.eventId, userId: staff.id, assignmentRole: "REGISTRATION" },
  });
  for (const officer of [registrationOfficer]) {
    const assignment = await prisma.staffAssignment.findFirst({
      where: {
        eventId: event.eventId,
        userId: officer.id,
        assignmentRole: "REGISTRATION",
        shiftId: shift.shiftId,
        stationId: null,
      },
    });
    if (assignment) {
      await prisma.staffAssignment.update({
        where: { id: assignment.id },
        data: { shiftId: shift.shiftId, status: "ASSIGNED", assignmentStatus: "ASSIGNED", assignedBy: staff.id },
      });
    } else {
      await prisma.staffAssignment.create({
        data: {
          eventId: event.eventId,
          shiftId: shift.shiftId,
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
  nric,
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
      nric,
      nricMasked: `••••${nric.slice(-4)}`,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
      contactNumber,
      email,
      accessibilityNotes,
      status: "ACTIVE",
      updatedById: staff.id,
    },
    create: {
      participantReference,
      nric,
      nricMasked: `••••${nric.slice(-4)}`,
      firstName,
      lastName,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
      gender: "U",
      contactNumber,
      email,
      preferredLanguage: "English",
      accessibilityNotes,
      status: "ACTIVE",
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
  const activeExisting = await prisma.participantEmergencyContact.findFirst({
    where: {
      participantId: participant.id,
      isPrimary: true,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });
  const existing = activeExisting || await prisma.participantEmergencyContact.findFirst({
    where: { participantId: participant.id },
    orderBy: { updatedAt: "desc" },
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
      id: crypto.randomUUID(),
      ...data,
      participantId: participant.id,
      createdById: staff.id,
    },
  });
}

async function ensureDemoRegistration(staff, participant, event) {
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
    },
    create: {
      participantId: participant.id,
      eventId: event.eventId,
      registeredBy: staff.id,
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber: 1,
      idempotencyKey,
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
  const token = DEMO_QR_TOKEN;
  const existingQr = await prisma.qRCodePass.findFirst({
    where: { registrationId: registration.registrationId },
    select: { id: true },
  });
  const qrId = existingQr?.id || "70000000-0000-4000-8000-000000000001";
  const qrData = {
    registrationId: registration.registrationId,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    tokenCiphertext: encrypt(token, encryptionContext("QRCodePass", qrId, "token")),
    tokenEncryptionVersion: 2,
    expiresAt: demoDate(30, 23, 59),
    issuedAt: demoTimestamp(),
    isActive: true,
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
  };
  const qr = existingQr
    ? await prisma.qRCodePass.update({
      where: { id: qrId },
      data: qrData,
    })
    : await prisma.qRCodePass.create({
      data: {
        id: qrId,
        ...qrData,
      },
    });
  return { registration, qr };
}

async function ensureScreenerQueueRegistration(staff, participant, event, station, queueNumber) {
  const registration = await prisma.eventRegistration.upsert({
    where: { participantId_eventId: { participantId: participant.id, eventId: event.eventId } },
    update: {
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber,
      checkedIn: false,
      checkedInAt: null,
    },
    create: {
      participantId: participant.id,
      eventId: event.eventId,
      registeredBy: staff.id,
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber,
      idempotencyKey: `seed-screener-queue-${participant.participantReference}`,
    },
  });
  const qr = await qrService.generateRegistrationQR(registration.registrationId, staff.id, { source: "seed-screener-queue" });

  const existingEntry = await prisma.queueEntry.findFirst({
    where: { registrationId: registration.registrationId, stationId: station.stationId },
    orderBy: { enteredAt: "desc" },
  });
  const queueData = {
    queueNumber,
    status: "WAITING",
    isPriority: false,
    priorityNotes: null,
    enteredAt: demoTimestamp(),
  };
  const queueEntry = existingEntry
    ? await prisma.queueEntry.update({ where: { id: existingEntry.id }, data: queueData })
    : await prisma.queueEntry.create({ data: { ...queueData, registrationId: registration.registrationId, stationId: station.stationId } });

  return { registration, queueEntry, qr };
}

async function seedReferralDeliveryLifecycle(staff, reviewer, event) {
  const participant = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-REFERRAL",
    nric: "TEST-NRIC-0005",
    firstName: "Synthetic",
    lastName: "Referral",
    dateOfBirth: "1980-01-01",
    contactNumber: "+65 8000 0005",
    email: "referral.example@example.test",
  });
  const registration = await prisma.eventRegistration.upsert({
    where: { participantId_eventId: { participantId: participant.id, eventId: event.eventId } },
    update: { registrationStatus: "COMPLETED", participantDisplayName: "Synthetic Referral" },
    create: {
      participantId: participant.id,
      eventId: event.eventId,
      registeredBy: staff.id,
      registrationStatus: "COMPLETED",
      participantDisplayName: "Synthetic Referral",
      queueNumber: 99,
      idempotencyKey: "seed-referral-lifecycle-registration",
    },
  });
  const review = await prisma.review.upsert({
    where: { registrationId_version: { registrationId: registration.registrationId, version: 1 } },
    update: {},
    create: {
      reviewId: "71000000-0000-4000-8000-000000000001",
      registrationId: registration.registrationId,
      version: 1,
      reviewedByUserId: reviewer.id,
      outcome: "REFER",
      urgency: "ROUTINE",
      clinicalSummary: "Synthetic seed review used only to demonstrate referral delivery lifecycle states.",
      recommendations: "No real participant or recipient data is associated with this demonstration record.",
    },
  });
  const referral = await prisma.referral.upsert({
    where: { referralId: "72000000-0000-4000-8000-000000000001" },
    update: { status: "SENT" },
    create: {
      referralId: "72000000-0000-4000-8000-000000000001",
      reviewId: review.reviewId,
      registrationId: registration.registrationId,
      createdByUserId: reviewer.id,
      revisionNumber: 1,
      destinationName: "Demonstration Eye Clinic",
      destinationEmail: "c***@example.invalid",
      reason: "Synthetic seed referral for delivery-status demonstrations only.",
      instructions: "Do not use this record for clinical care.",
      urgency: "ROUTINE",
      status: "SENT",
      referredAt: demoTimestamp(),
    },
  });
  const delivery = await prisma.notificationDelivery.upsert({
    where: { id: "73000000-0000-4000-8000-000000000001" },
    update: { status: "DELIVERED", deliveredAt: demoTimestamp() },
    create: {
      id: "73000000-0000-4000-8000-000000000001",
      userId: reviewer.id,
      referralId: referral.referralId,
      status: "DELIVERED",
      recipient: "c***@example.invalid",
      recipientCiphertext: null,
      subject: "Synthetic encrypted referral demonstration",
      body: "Synthetic lifecycle record; no recipient or clinical content.",
      providerMessageId: "seed-ses-delivered-message",
      attemptCount: 1,
      sentAt: demoTimestamp(),
      deliveredAt: demoTimestamp(),
    },
  });
  await prisma.providerEventReceipt.upsert({
    where: { providerEventId: "seed-sns-delivery-event" },
    update: { deliveryId: delivery.id, appliedStatus: "DELIVERED" },
    create: {
      id: "74000000-0000-4000-8000-000000000001",
      provider: "AWS_SES_SNS",
      providerEventId: "seed-sns-delivery-event",
      providerMessageIdHash: crypto.createHash("sha256").update("seed-ses-delivered-message").digest("hex"),
      deliveryId: delivery.id,
      eventType: "DELIVERY",
      appliedStatus: "DELIVERED",
    },
  });
  return { referral, delivery };
}

async function seedSyncEvidence(staff, event, registration, stations) {
  const definitions = [
    { suffix: "001", status: "APPLIED", errorCode: null },
    { suffix: "002", status: "PENDING", errorCode: null },
    { suffix: "003", status: "CONFLICT", errorCode: "REGISTRATION_NOT_SCREENABLE" },
    { suffix: "004", status: "FAILED", errorCode: "SYNC_APPLY_FAILED" },
    { suffix: "005", status: "PROCESSING", errorCode: null },
  ];
  const seeded = [];
  for (const [index, definition] of definitions.entries()) {
    const station = stations[index % stations.length];
    const id = `75000000-0000-4000-8000-000000000${definition.suffix}`;
    const clientActionId = `75200000-0000-4000-8000-000000000${definition.suffix}`;
    const requestFingerprint = crypto.createHash("sha256").update(`seed-sync-${definition.suffix}`).digest("hex");
    const data = {
      userId: staff.id,
      eventId: event.eventId,
      stationId: station.stationId,
      clientActionId,
      requestFingerprint,
      operation: "UPDATE",
      entityType: "ScreeningResult",
      entityId: registration.registrationId,
      payload: { schemaVersion: 1, stationType: station.stationType },
      status: definition.status,
      retryCount: 0,
      version: definition.status === "PENDING" ? 0 : definition.status === "PROCESSING" ? 1 : 2,
      processingStartedAt: definition.status === "PROCESSING" ? demoTimestamp() : null,
      errorCode: definition.errorCode,
      ...(definition.status === "APPLIED" ? {
        responseSnapshot: {
          resultId: registration.registrationId,
          overallFlag: "NORMAL",
          isFlagged: false,
          ruleVersion: "VSMS-SEED-1.0",
        },
      } : {}),
    };
    const syncAction = await prisma.syncAction.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    const transitionStatuses = definition.status === "PENDING"
      ? ["PENDING"]
      : definition.status === "PROCESSING"
        ? ["PENDING", "PROCESSING"]
        : ["PENDING", "PROCESSING", definition.status];
    for (const [transitionIndex, status] of transitionStatuses.entries()) {
      const transitionId = `75100000-0000-4${index}${transitionIndex}0-8000-000000000${definition.suffix}`;
      const transitionData = {
        syncActionId: syncAction.id,
        sequence: transitionIndex,
        status,
        retryCount: 0,
        errorCode: status === definition.status ? definition.errorCode : null,
      };
      await prisma.syncActionTransition.upsert({
        where: { id: transitionId },
        update: transitionData,
        create: { id: transitionId, ...transitionData },
      });
    }
    seeded.push(syncAction);
  }
  return seeded;
}

async function seedQueueEntries(staff, event, registration, stations) {
  if (event.status !== "IN_PROGRESS" || stations.length === 0) return null;

  const firstStation = stations[0];
  const existing = await prisma.queueEntry.findFirst({
    where: { registrationId: registration.registrationId, stationId: firstStation.stationId },
  });
  if (existing) return existing;

  const queueEntry = await prisma.queueEntry.create({
    data: {
      registrationId: registration.registrationId,
      stationId: firstStation.stationId,
      queueNumber: registration.queueNumber || 1,
      status: "WAITING",
      isPriority: true,
      priorityNotes: "Seeded urgent follow-up required after screening",
      enteredAt: demoTimestamp(),
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: staff.id,
      action: "QUEUE_JOINED",
      entityName: "QueueEntry",
      entityId: queueEntry.id,
      outcome: "SUCCESS",
      oldValue: null,
      newValue: {
        eventId: event.eventId,
        stationId: firstStation.stationId,
        registrationId: registration.registrationId,
        queueNumber: queueEntry.queueNumber,
        status: "WAITING",
      },
    },
  });

  const fromStation = stations[1];
  if (fromStation) {
    await prisma.queueMovement.create({
      data: {
        registrationId: registration.registrationId,
        fromStationId: fromStation.stationId,
        toStationId: firstStation.stationId,
        movedBy: staff.id,
        movementReason: "Seeded station transfer demonstration",
        movementTime: demoTimestamp(),
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: staff.id,
        action: "QUEUE_PRIORITY_UPDATED",
        entityName: "QueueEntry",
        entityId: queueEntry.id,
        outcome: "SUCCESS",
        oldValue: { isPriority: false, priorityNotes: null },
        newValue: { isPriority: true, priorityNotes: queueEntry.priorityNotes },
      },
    });
  }
  return queueEntry;
}

// Representative append-only audit evidence across every audited domain.
// Idempotent: each record carries a deterministic requestId; if one already
// exists the block is skipped so re-seeding does not duplicate history.
async function seedDomainAuditEvidence({ staff, reviewer, liveEvent, completedEvent, registration, qr, queueEntry }) {
  const records = [
    {
      table: "authAuditLog",
      key: "76000000-0000-4000-8000-000000000001",
      data: {
        userId: staff.id,
        eventType: "LOGIN_SUCCESS",
        outcome: "SUCCESS",
        ipAddress: "127.0.0.1",
        userAgent: "seed-data",
      },
    },
    {
      table: "authAuditLog",
      key: "76000000-0000-4000-8000-000000000002",
      data: {
        userId: staff.id,
        eventType: "LOGIN_FAILURE",
        outcome: "FAILED",
        failureCategory: "INVALID_CREDENTIALS",
        ipAddress: "127.0.0.1",
        userAgent: "seed-data",
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000011",
      data: {
        userId: staff.id,
        action: "EVENT_REGISTRATION_CREATED",
        entityName: "EventRegistration",
        entityId: registration.registrationId,
        outcome: "SUCCESS",
        newValue: { eventId: liveEvent.eventId, participantReference: "VSMS-DEMO-000002" },
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000012",
      data: {
        userId: reviewer.id,
        action: "SCREENING_RESULT_RECORDED",
        entityName: "ScreeningResult",
        entityId: registration.registrationId,
        outcome: "SUCCESS",
        newValue: { eventId: liveEvent.eventId, overallFlag: "REVIEW" },
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000013",
      data: {
        userId: staff.id,
        action: "QR_GENERATED",
        entityName: "QRCodePass",
        entityId: qr.id,
        outcome: "SUCCESS",
        newValue: { registrationId: registration.registrationId },
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000014",
      data: {
        userId: reviewer.id,
        action: "QR_VERIFIED",
        entityName: "QRCodePass",
        entityId: qr.id,
        outcome: "SUCCESS",
        newValue: { eventId: liveEvent.eventId, valid: true },
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000015",
      data: {
        userId: reviewer.id,
        action: "CLINICAL_REVIEW_RECORDED",
        entityName: "Review",
        entityId: registration.registrationId,
        outcome: "SUCCESS",
        newValue: { eventId: liveEvent.eventId, outcome: "REFER" },
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000016",
      data: {
        userId: reviewer.id,
        action: "REFERRAL_ISSUED",
        entityName: "Referral",
        entityId: registration.registrationId,
        outcome: "SUCCESS",
        newValue: { eventId: completedEvent.eventId, status: "SENT" },
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000017",
      data: {
        userId: staff.id,
        action: "SCREENING_SYNC_BATCH",
        entityName: "SyncActionBatch",
        entityId: registration.registrationId,
        outcome: "SUCCESS",
        newValue: { eventId: liveEvent.eventId, applied: 5 },
      },
    },
    {
      table: "auditLog",
      key: "76000000-0000-4000-8000-000000000018",
      data: {
        userId: staff.id,
        action: "QUEUE_JOINED",
        entityName: "QueueEntry",
        entityId: queueEntry?.id || registration.registrationId,
        outcome: "SUCCESS",
        newValue: { eventId: liveEvent.eventId, queueNumber: registration.queueNumber || 1 },
      },
    },
  ];

  for (const record of records) {
    const existing = await prisma[record.table].findUnique({ where: { id: record.key } }).catch(() => null);
    if (existing) continue;
    await prisma[record.table].create({
      data: {
        id: record.key,
        requestId: record.key,
        ...record.data,
      },
    });
  }
  return records.length;
}

async function seedDemoData(staff, registrationOfficer, reviewer, screener) {
  const upcomingEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-tampines",
    name: "VSMS Synthetic Upcoming Event",
    venue: "Synthetic Venue One",
    status: "PUBLISHED",
    startsAt: demoDate(2, 1),
    endsAt: demoDate(2, 9),
    capacity: 120,
  });
  const liveEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-jurong-live",
    name: "VSMS Synthetic Active Event",
    venue: "Synthetic Venue Two",
    status: "IN_PROGRESS",
    // Keep the active fixture available for the full current Singapore day.
    startsAt: singaporeToday(0),
    endsAt: singaporeToday(23, 59),
    capacity: 80,
  });
  const screenerEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-screener-station-live",
    name: "VSMS Screener Station Event",
    venue: "Synthetic Venue Screener Station",
    status: "IN_PROGRESS",
    startsAt: singaporeToday(0),
    endsAt: singaporeToday(23, 59),
    capacity: 60,
  });
  const completedEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-woodlands-complete",
    name: "VSMS Synthetic Completed Event",
    venue: "Synthetic Venue Three",
    status: "COMPLETED",
    startsAt: demoDate(-14, 1),
    endsAt: demoDate(-14, 9),
    capacity: 100,
  });
  const outreachEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-pasir-ris-outreach",
    name: "VSMS Synthetic Outreach Event",
    venue: "Synthetic Venue Four",
    status: "PUBLISHED",
    startsAt: demoDate(4, 2),
    endsAt: demoDate(4, 10),
    capacity: 90,
  });
  const schoolEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-school-morning",
    name: "VSMS Synthetic School Screening Morning",
    venue: "Synthetic Venue Five",
    status: "PUBLISHED",
    startsAt: demoDate(6, 1),
    endsAt: demoDate(6, 8),
    capacity: 140,
  });
  const followUpEvent = await upsertDemoEvent(staff, {
    key: "seed-demo-follow-up-clinic",
    name: "VSMS Synthetic Follow-up Clinic",
    venue: "Synthetic Venue Six",
    status: "COMPLETED",
    startsAt: demoDate(-7, 1),
    endsAt: demoDate(-7, 9),
    capacity: 75,
  });
  const [, liveStructure, screenerStructure] = await Promise.all([
    seedEventStructure(upcomingEvent, staff, registrationOfficer),
    seedEventStructure(liveEvent, staff, registrationOfficer),
    seedEventStructure(screenerEvent, staff, registrationOfficer),
    seedEventStructure(completedEvent, staff, registrationOfficer),
  ]);

  await Promise.all([
    ...[upcomingEvent, liveEvent, completedEvent].map((event) => ensureDemoMembership(event, staff, ["EVENT_MANAGER"], staff)),
    ensureDemoMembership(liveEvent, registrationOfficer, ["REGISTRATION"], staff),
    ensureDemoMembership(liveEvent, reviewer, ["REVIEWER"], staff),
    ensureDemoMembership(screenerEvent, screener, ["SCREENER"], staff),
  ]);

  const visualAcuityStation = screenerStructure.stations.find((station) => station.stationType === "VISUAL_ACUITY");
  if (!visualAcuityStation) throw new Error("Visual Acuity station was not created for the screener event");
  const screenerAssignment = await prisma.staffAssignment.findFirst({
    where: {
      eventId: screenerEvent.eventId,
      shiftId: screenerStructure.shift.shiftId,
      userId: screener.id,
      stationId: visualAcuityStation.stationId,
      assignmentRole: "SCREENER",
    },
  });
  const screenerAssignmentData = {
    assignedBy: staff.id,
    assignmentStatus: "CONFIRMED",
    status: "CONFIRMED",
  };
  if (screenerAssignment) {
    await prisma.staffAssignment.update({ where: { id: screenerAssignment.id }, data: screenerAssignmentData });
  } else {
    await prisma.staffAssignment.create({
      data: {
        ...screenerAssignmentData,
        eventId: screenerEvent.eventId,
        shiftId: screenerStructure.shift.shiftId,
        stationId: visualAcuityStation.stationId,
        userId: screener.id,
        assignmentRole: "SCREENER",
      },
    });
  }

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
    nric: "TEST-NRIC-0001",
    firstName: "Synthetic",
    lastName: "Alpha",
    dateOfBirth: "1970-01-01",
    contactNumber: "+65 8000 0001",
    email: "synthetic.alpha@example.test",
    accessibilityNotes: "Synthetic fixture: large-print instructions.",
  });
  const daniel = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000002",
    nric: "TEST-NRIC-0002",
    firstName: "Synthetic",
    lastName: "Bravo",
    dateOfBirth: "1971-02-02",
    contactNumber: "+65 8000 0002",
    email: "synthetic.bravo@example.test",
  });
  const priya = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000003",
    nric: "TEST-NRIC-0003",
    firstName: "Synthetic",
    lastName: "Charlie",
    dateOfBirth: "1972-03-03",
    contactNumber: "+65 8000 0003",
    email: "synthetic.charlie@example.test",
  });
  const marcus = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000004",
    nric: "TEST-NRIC-0004",
    firstName: "Synthetic",
    lastName: "Delta",
    dateOfBirth: "1973-04-04",
    contactNumber: "+65 8000 0004",
    email: "synthetic.delta@example.test",
  });

  await ensureDemoContact(staff, aisha, {
    contactName: "Synthetic Contact Alpha",
    relationship: "Fixture contact",
    phoneNumber: "+65 8000 0101",
    email: "synthetic.contact.alpha@example.test",
  });
  await ensureDemoContact(staff, daniel, {
    contactName: "Synthetic Contact Bravo",
    relationship: "Fixture contact",
    phoneNumber: "+65 8000 0102",
    email: "synthetic.contact.bravo@example.test",
  });
  await ensureDemoContact(staff, priya, {
    contactName: "Synthetic Contact Charlie",
    relationship: "Fixture contact",
    phoneNumber: "+65 8000 0103",
    email: "synthetic.contact.charlie@example.test",
  });

  const { registration, qr } = await ensureDemoRegistration(
    staff,
    daniel,
    liveEvent
  );

  const screenerQueue = await Promise.all([
    ensureScreenerQueueRegistration(staff, aisha, screenerEvent, visualAcuityStation, 1),
    ensureScreenerQueueRegistration(staff, daniel, screenerEvent, visualAcuityStation, 2),
    ensureScreenerQueueRegistration(staff, priya, screenerEvent, visualAcuityStation, 3),
  ]);

  for (const station of liveStructure.stations) {
    const seedByType = {
      VISUAL_ACUITY: {
        resultData: { fixture: "SYNTHETIC_ACCEPTANCE_ONLY", od: { kind: "FRACTION", denominator: 18 }, os: { kind: "FRACTION", denominator: 24 }, chartDistanceMetres: 6, withUsualDistanceGlasses: true },
        overallFlag: "REFER",
        flagSummary: "Reduced visual acuity in both eyes",
        ruleVersion: "VSMS-VA-1.0",
      },
      REFRACTION: {
        resultData: {
          fixture: "SYNTHETIC_ACCEPTANCE_ONLY",
          measurementStatus: "COMPLETED",
          wearsDistanceGlasses: true,
          od: { sphere: -1.25, cylinder: -0.50, axis: 90 },
          os: { sphere: -3.50, cylinder: -3.50, axis: 175 },
          notes: "High astigmatism OS",
        },
        overallFlag: "REVIEW",
        flagSummary: "OS high astigmatism CYL -3.50; Anisometropia SPH difference 2.25 D",
        ruleVersion: "VSMS-REF-1.0",
      },
      COLOUR_VISION: {
        resultData: { fixture: "SYNTHETIC_ACCEPTANCE_ONLY", testKit: "ISHIHARA", platesPresented: 11, odCorrect: 11, osCorrect: 2 },
        overallFlag: "URGENT",
        flagSummary: "Critical colour-vision asymmetry OD 11/11 vs OS 2/11",
        ruleVersion: "VSMS-CV-1.0",
      },
    };
    const seeded = seedByType[station.stationType] || {
      resultData: { fixture: "SYNTHETIC_ACCEPTANCE_ONLY", notes: "Synthetic fixture placeholder" },
      overallFlag: "REVIEW",
      flagSummary: "Seeded review flag",
      ruleVersion: "VSMS-SEED-1.0",
    };
    const result = {
      recordedByUserId: reviewer.id,
      screeningType: station.stationType,
      resultData: seeded.resultData,
      overallFlag: seeded.overallFlag,
      isFlagged: true,
      flagSummary: seeded.flagSummary,
      ruleVersion: seeded.ruleVersion,
      idempotencyKey: `seed-review-${registration.registrationId.slice(0, 8)}-${station.stationId.slice(0, 8)}`,
    };
    await prisma.screeningResult.upsert({
      where: { registrationId_stationId: { registrationId: registration.registrationId, stationId: station.stationId } },
      update: result,
      create: { ...result, registrationId: registration.registrationId, stationId: station.stationId },
    });
  }

  const syncEvidence = await seedSyncEvidence(staff, liveEvent, registration, liveStructure.stations);

  const queueEntry = await seedQueueEntries(staff, liveEvent, registration, liveStructure.stations);

  const referralLifecycle = await seedReferralDeliveryLifecycle(staff, reviewer, completedEvent);

  const auditEvidenceCount = await seedDomainAuditEvidence({
    staff,
    reviewer,
    liveEvent,
    completedEvent,
    registration,
    qr,
    queueEntry,
    screenerQueue,
  });

  return {
    events: { upcomingEvent, liveEvent, screenerEvent, completedEvent, outreachEvent, schoolEvent, followUpEvent },
    participants: { aisha, daniel, priya, marcus },
    registration,
    qr,
    queueEntry,
    screenerQueue,
    syncEvidence,
    referralLifecycle,
    auditEvidenceCount,
  };
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const roles = await seedRoles();
  const staff = await seedStaff(roles, passwordHash);
  const registrationOfficer = await seedRegistrationOfficer(roles, staff, passwordHash);
  const reviewer = await seedReviewer(roles, staff, passwordHash);
  const screener = await seedScreener(roles, staff, passwordHash);
  await seedPermissions(roles, staff);
  await seedStationTemplates();
  const demo = await seedDemoData(staff, registrationOfficer, reviewer, screener);
  console.log(`Seeded roles, permissions, station templates, staff profile, and demonstration data for ${staff.email}.`);
  console.log(`Upcoming event: ${demo.events.upcomingEvent.name} (${demo.events.upcomingEvent.eventId})`);
  console.log(`Live event: ${demo.events.liveEvent.name} (${demo.events.liveEvent.eventId})`);
  console.log(`Screener event: ${demo.events.screenerEvent.name} (${demo.events.screenerEvent.eventId})`);
  console.log(`Outreach event: ${demo.events.outreachEvent.name} (${demo.events.outreachEvent.eventId})`);
  console.log(`School event: ${demo.events.schoolEvent.name} (${demo.events.schoolEvent.eventId})`);
  console.log(`Follow-up event: ${demo.events.followUpEvent.name} (${demo.events.followUpEvent.eventId})`);
  console.log(`Screener queue: ${demo.screenerQueue.map(({ registration }) => `#${registration.queueNumber} ${registration.participantDisplayName}`).join(", ")}`);
  console.log(`Ready participant: ${demo.participants.aisha.participantReference} - Synthetic Alpha`);
  console.log(`Needs emergency contact: ${demo.participants.marcus.participantReference} - Synthetic Delta`);
  console.log(`Registered participant: ${demo.participants.daniel.participantReference} - Synthetic Bravo`);
  console.log(`Reviewer profile: ${reviewer.email} (local role: REVIEWER)`);
  console.log(`Screener profile: ${screener.email} (local role: SCREENER, Visual Acuity duty)`);
  console.log(`Registration ID: ${demo.registration.registrationId}`);
  console.log(`Demo QR pass: ${demo.qr.id}`);
  console.log(`Audit evidence records: ${demo.auditEvidenceCount}`);
  console.log("Synthetic QR pass created (do not copy the bearer value into evidence).");
  console.log(`Synthetic referral delivery: ${demo.referralLifecycle.delivery.status} (${demo.referralLifecycle.delivery.id})`);
  const liveStations = await prisma.station.findMany({
    where: { eventId: demo.events.liveEvent.eventId, isActive: true },
    orderBy: { stationOrder: "asc" },
    select: { stationType: true, stationName: true },
  });
  console.log(
    `Live event stations: ${liveStations.map((s) => s.stationType).join(", ") || "(none)"}`,
  );
  console.log("Confirm stations via GET /api/v1/events/{eventId}/stations");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
