const crypto = require("crypto");
const bcrypt = require("bcrypt");
require("dotenv").config();
const prisma = require("./prismaClient");
const { encrypt, encryptionContext } = require("../utils/cryptoUtils");

const DEMO_PASSWORD = process.env.VSMS_DEMO_PASSWORD || "Demo-Only-Change-Me-2026!";
if (process.env.NODE_ENV === "production" && !process.env.VSMS_DEMO_PASSWORD) {
  throw new Error("VSMS_DEMO_PASSWORD is required for production seed execution");
}

// Valid 64-char hex token (matches the QR_TOKEN_PATTERN used by manual check-in)
// so the seeded demo pass is demonstrable end-to-end.
const DEMO_QR_TOKEN = "ab".repeat(32);

const roleDefinitions = [
  ["ADMINISTRATOR", "Full administrative access", 1],
  ["EVENT_MANAGER", "Creates and manages events", 2],
  ["REGISTRATION_OFFICER", "Registers participants and records consent", 3],
  ["SCREENER", "Performs participant screening", 4],
  ["REVIEWER", "Reviews screening outcomes", 5],
  ["SUPPORT", "Supports event operations", 6],
];

const permissionNames = [
  "participants:read",
  "participants:write",
  "participants:cross-event-reuse",
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
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000005",
    templateKey: "REFRACTION",
    version: 1,
    name: "Refraction",
    description: "Capture autorefractor SPH/CYL/Axis readings for both eyes.",
    defaultCapacity: 3,
  },
  {
    stationTemplateId: "60000000-0000-4000-8000-000000000006",
    templateKey: "COLOUR_VISION",
    version: 1,
    name: "Colour vision",
    description: "Record Ishihara plate scores for each eye.",
    defaultCapacity: 3,
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
      designation: "Event Administrator",
      status: "ACTIVE",
      sysRole: "ADMIN",
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
  const email = String(process.env.SEED_REGISTRATION_EMAIL || "registration@vsms.local").trim().toLowerCase();
  const officer = await prisma.user.upsert({
    where: { email },
    update: { status: "ACTIVE", sysRole: "STAFF" },
    create: {
      username: email,
      fullName: process.env.SEED_REGISTRATION_NAME || "Avery Lim",
      email,
      employeeNumber: process.env.SEED_REGISTRATION_EMPLOYEE_NUMBER || "SEED-REG-001",
      department: "Event Operations",
      designation: "Registration Officer",
      status: "ACTIVE",
      sysRole: "STAFF",
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
  // Demo events are configured for Asia/Singapore. Derive the calendar date
  // there, then return the equivalent UTC instant for storage in PostgreSQL.
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
    ["COLOUR_VISION", "Colour vision", 3],
    ["EYE_HEALTH", "Eye health", 4],
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

  await prisma.staffAssignment.deleteMany({
    where: { eventId: event.eventId, userId: staff.id, assignmentRole: "REGISTRATION" },
  });
  const registrationOfficers = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      userRoles: { some: { role: { roleName: "REGISTRATION_OFFICER" } } },
    },
    select: { id: true },
  });
  for (const officer of registrationOfficers) {
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
      passToken: DEMO_QR_TOKEN,
    },
    create: {
      participantId: participant.id,
      eventId: event.eventId,
      registeredBy: staff.id,
      registrationStatus: "SIGNED_UP",
      participantDisplayName: `${participant.firstName} ${participant.lastName}`,
      queueNumber: 1,
      idempotencyKey,
      passToken: DEMO_QR_TOKEN,
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

  const token = DEMO_QR_TOKEN;
  const existingQr = await prisma.qRCodePass.findFirst({
    where: { registrationId: registration.registrationId },
    select: { id: true },
  });
  const qrId = existingQr?.id || crypto.randomUUID();
  const qrData = {
    registrationId: registration.registrationId,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    tokenCiphertext: encrypt(token, encryptionContext("QRCodePass", qrId, "token")),
    tokenEncryptionVersion: 2,
    expiresAt: demoDate(30, 23, 59),
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

async function seedReferralDeliveryLifecycle(staff, reviewer, event) {
  const participant = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-REFERRAL",
    nric: "S1000005E",
    firstName: "Referral",
    lastName: "Example",
    dateOfBirth: "1980-01-01",
    contactNumber: "+65 8000 0005",
    email: "referral.example@example.test",
  });
  const registration = await prisma.eventRegistration.upsert({
    where: { participantId_eventId: { participantId: participant.id, eventId: event.eventId } },
    update: { registrationStatus: "COMPLETED", participantDisplayName: "Referral Example" },
    create: {
      participantId: participant.id,
      eventId: event.eventId,
      registeredBy: staff.id,
      registrationStatus: "COMPLETED",
      participantDisplayName: "Referral Example",
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
      referredAt: new Date(),
    },
  });
  const delivery = await prisma.notificationDelivery.upsert({
    where: { id: "73000000-0000-4000-8000-000000000001" },
    update: { status: "DELIVERED", deliveredAt: new Date() },
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
      sentAt: new Date(),
      deliveredAt: new Date(),
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
      processingStartedAt: definition.status === "PROCESSING" ? new Date() : null,
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
      enteredAt: new Date(),
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
    endsAt: demoDate(0, 23, 59),
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
    nric: "S1000001A",
    firstName: "Aisha",
    lastName: "Rahman",
    dateOfBirth: "1988-04-12",
    contactNumber: "+65 8123 4567",
    email: "aisha.rahman@example.test",
    accessibilityNotes: "Prefers large-print instructions.",
  });
  const daniel = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000002",
    nric: "S1000002B",
    firstName: "Daniel",
    lastName: "Tan",
    dateOfBirth: "1975-09-23",
    contactNumber: "+65 8234 5678",
    email: "daniel.tan@example.test",
  });
  const priya = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000003",
    nric: "S1000003C",
    firstName: "Priya",
    lastName: "Nair",
    dateOfBirth: "1992-02-18",
    contactNumber: "+65 8345 6789",
    email: "priya.nair@example.test",
  });
  const marcus = await upsertDemoParticipant(staff, {
    participantReference: "VSMS-DEMO-000004",
    nric: "S1000004D",
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
    const seedByType = {
      VISUAL_ACUITY: {
        resultData: { od: { kind: "FRACTION", denominator: 18 }, os: { kind: "FRACTION", denominator: 24 }, chartDistanceMetres: 6, withUsualDistanceGlasses: true },
        overallFlag: "REFER",
        flagSummary: "Reduced visual acuity in both eyes",
        ruleVersion: "VSMS-VA-1.0",
      },
      REFRACTION: {
        resultData: {
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
        resultData: { testKit: "ISHIHARA", platesPresented: 11, odCorrect: 11, osCorrect: 2 },
        overallFlag: "URGENT",
        flagSummary: "Critical colour-vision asymmetry OD 11/11 vs OS 2/11",
        ruleVersion: "VSMS-CV-1.0",
      },
    };
    const seeded = seedByType[station.stationType] || {
      resultData: { notes: "Seed placeholder" },
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
  });

  return {
    events: { upcomingEvent, liveEvent, completedEvent },
    participants: { aisha, daniel, priya, marcus },
    aishaConsent,
    registration,
    qr,
    queueEntry,
    syncEvidence,
    referralLifecycle,
    auditEvidenceCount,
  };
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const roles = await seedRoles();
  const staff = await seedStaff(roles, passwordHash);
  await seedRegistrationOfficer(roles, staff, passwordHash);
  const reviewer = await seedReviewer(roles, staff, passwordHash);
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
  console.log(`Reviewer profile: ${reviewer.email} (local role: REVIEWER)`);
  console.log(`Registration ID: ${demo.registration.registrationId}`);
  console.log(`Demo QR pass: ${demo.qr.id}`);
  console.log(`Audit evidence records: ${demo.auditEvidenceCount}`);
  console.log(`Demo QR token: VSMS-DEMO-QR-001`);
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
