const crypto = require("crypto");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS = {
    event: "11111111-1111-4111-8111-111111111111",
    registeredParticipant: "22222222-2222-4222-8222-222222222221",
    newParticipant: "22222222-2222-4222-8222-222222222222",
    primaryContact: "33333333-3333-4333-8333-333333333331",
    secondaryContact: "33333333-3333-4333-8333-333333333332",
    consentForm: "44444444-4444-4444-8444-444444444444",
    acceptedConsent: "55555555-5555-4555-8555-555555555555",
    registration: "66666666-6666-4666-8666-666666666666",
    registrationHistory: "77777777-7777-4777-8777-777777777777",
    qrCode: "88888888-8888-4888-8888-888888888888",
    auditLog: "99999999-9999-4999-8999-999999999999",
    authAuditLog: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authRequest: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    authDevice: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

const roleDefinitions = [
    ["ADMINISTRATOR", "Full administrative access", 1],
    ["EVENT_MANAGER", "Creates and manages events", 2],
    ["REGISTRATION_OFFICER", "Registers participants and records consent", 3],
    ["SCREENER", "Performs participant screening", 4],
    ["REVIEWER", "Reviews screening outcomes", 5],
];

function daysFromNow(days) {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() + days);
    value.setUTCHours(0, 0, 0, 0);
    return value;
}

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

async function seedPermissions(roles, staff) {
    const names = [
        "participants:read",
        "participants:write",
        "consents:record",
        "registrations:create",
        "registrations:read",
        "audit:read",
    ];
    const permissions = new Map();
    for (const permissionName of names) {
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
        const allowed = roleName === "ADMINISTRATOR" ? names : names.filter((name) => name !== "audit:read");
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

async function seedStaff(roles) {
    const email = (process.env.SEED_STAFF_EMAIL || "seed.admin@cryptix.local").trim().toLowerCase();
    const existingStaff = await prisma.user.findUnique({ where: { email } });

    const staff = await prisma.user.upsert({
        where: { email },
        update: { status: "ACTIVE" },
        create: {
            fullName: process.env.SEED_STAFF_NAME || "Seed Administrator",
            email,
            employeeNumber: process.env.SEED_STAFF_EMPLOYEE_NUMBER || "SEED-ADMIN-001",
            department: "Operations",
            designation: "Registration Officer",
            status: "ACTIVE",
        },
    });

    for (const roleName of ["ADMINISTRATOR", "REGISTRATION_OFFICER"]) {
        const role = roles.get(roleName);
        await prisma.userRole.upsert({
            where: {
                userId_roleId: {
                    userId: staff.id,
                    roleId: role.id,
                },
            },
            update: {},
            create: {
                userId: staff.id,
                roleId: role.id,
            },
        });
    }

    return { staff, created: !existingStaff };
}

async function seedEvent() {
    return prisma.event.upsert({
        where: { id: IDS.event },
        update: {
            eventName: "Community Health Screening",
            location: "Cryptix Community Hall",
            eventDate: daysFromNow(14),
            startTime: new Date("1970-01-01T09:00:00.000Z"),
            endTime: new Date("1970-01-01T17:00:00.000Z"),
            status: "PUBLISHED",
        },
        create: {
            id: IDS.event,
            eventName: "Community Health Screening",
            location: "Cryptix Community Hall",
            eventDate: daysFromNow(14),
            startTime: new Date("1970-01-01T09:00:00.000Z"),
            endTime: new Date("1970-01-01T17:00:00.000Z"),
            status: "PUBLISHED",
        },
    });
}

async function seedParticipants(staff) {
    const registeredParticipant = await prisma.participant.upsert({
        where: { id: IDS.registeredParticipant },
        update: {
            participantReference: "VSMS-2026-000001",
            firstName: "John",
            lastName: "Tan",
            dateOfBirth: new Date("1988-04-15T00:00:00.000Z"),
            gender: "M",
            contactNumber: "+6591234567",
            emergencyContact: "+6598765432",
            consentGiven: true,
            updatedById: staff.id,
        },
        create: {
            id: IDS.registeredParticipant,
            participantReference: "VSMS-2026-000001",
            firstName: "John",
            lastName: "Tan",
            dateOfBirth: new Date("1988-04-15T00:00:00.000Z"),
            gender: "M",
            contactNumber: "+6591234567",
            emergencyContact: "+6598765432",
            consentGiven: true,
            createdById: staff.id,
            updatedById: staff.id,
        },
    });

    const newParticipant = await prisma.participant.upsert({
        where: { id: IDS.newParticipant },
        update: {
            participantReference: "VSMS-2026-000002",
            firstName: "Mary",
            lastName: "Lim",
            dateOfBirth: new Date("1994-09-21T00:00:00.000Z"),
            gender: "F",
            contactNumber: "+6581234567",
            emergencyContact: "+6587654321",
            consentGiven: false,
            updatedById: staff.id,
        },
        create: {
            id: IDS.newParticipant,
            participantReference: "VSMS-2026-000002",
            firstName: "Mary",
            lastName: "Lim",
            dateOfBirth: new Date("1994-09-21T00:00:00.000Z"),
            gender: "F",
            contactNumber: "+6581234567",
            emergencyContact: "+6587654321",
            consentGiven: false,
            createdById: staff.id,
            updatedById: staff.id,
        },
    });

    return { registeredParticipant, newParticipant };
}

async function seedEmergencyContacts(staff, participants) {
    await prisma.participantEmergencyContact.upsert({
        where: { id: IDS.primaryContact },
        update: {
            contactName: "Sarah Tan",
            relationship: "Spouse",
            phoneNumber: "+6598765432",
            email: "sarah.tan@example.com",
            isPrimary: true,
            status: "ACTIVE",
            updatedById: staff.id,
        },
        create: {
            id: IDS.primaryContact,
            participantId: participants.registeredParticipant.id,
            contactName: "Sarah Tan",
            relationship: "Spouse",
            phoneNumber: "+6598765432",
            email: "sarah.tan@example.com",
            isPrimary: true,
            status: "ACTIVE",
            createdById: staff.id,
            updatedById: staff.id,
        },
    });

    await prisma.participantEmergencyContact.upsert({
        where: { id: IDS.secondaryContact },
        update: {
            contactName: "David Lim",
            relationship: "Brother",
            phoneNumber: "+6587654321",
            email: "david.lim@example.com",
            isPrimary: true,
            status: "ACTIVE",
            updatedById: staff.id,
        },
        create: {
            id: IDS.secondaryContact,
            participantId: participants.newParticipant.id,
            contactName: "David Lim",
            relationship: "Brother",
            phoneNumber: "+6587654321",
            email: "david.lim@example.com",
            isPrimary: true,
            status: "ACTIVE",
            createdById: staff.id,
            updatedById: staff.id,
        },
    });
}

async function seedConsentForm(staff) {
    const contentHash = crypto
        .createHash("sha256")
        .update("VSMS participant consent form version 1.0")
        .digest("hex");

    return prisma.consentFormVersion.upsert({
        where: {
            formCode_versionNumber: {
                formCode: "VSMS-CONSENT",
                versionNumber: "1.0",
            },
        },
        update: {
            title: "Participant Screening Consent",
            contentText: "I confirm that the screening process, use of my information, potential risks, privacy safeguards, and my right to decline or withdraw have been explained to me. I voluntarily consent to participate in this event screening.",
            contentHash,
            documentObjectKey: "seed/consent/vsms-consent-v1.pdf",
            effectiveFrom: daysFromNow(-30),
            effectiveTo: null,
            isActive: true,
        },
        create: {
            id: IDS.consentForm,
            formCode: "VSMS-CONSENT",
            versionNumber: "1.0",
            title: "Participant Screening Consent",
            contentText: "I confirm that the screening process, use of my information, potential risks, privacy safeguards, and my right to decline or withdraw have been explained to me. I voluntarily consent to participate in this event screening.",
            contentHash,
            documentObjectKey: "seed/consent/vsms-consent-v1.pdf",
            effectiveFrom: daysFromNow(-30),
            isActive: true,
            createdById: staff.id,
        },
    });
}

async function seedCompletedRegistration(staff, event, participant, consentForm) {
    const registration = await prisma.eventRegistration.upsert({
        where: { id: IDS.registration },
        update: {
            participantId: participant.id,
            eventId: event.id,
            queueNumber: 1,
            registrationStatus: "REGISTERED",
            registeredBy: staff.id,
            idempotencyKey: "seed-registration-0001",
            checkedIn: false,
            checkedInAt: null,
        },
        create: {
            id: IDS.registration,
            participantId: participant.id,
            eventId: event.id,
            queueNumber: 1,
            registrationStatus: "REGISTERED",
            registeredBy: staff.id,
            idempotencyKey: "seed-registration-0001",
        },
    });

    await prisma.participantConsent.upsert({
        where: { id: IDS.acceptedConsent },
        update: {
            participantId: participant.id,
            eventId: event.id,
            registrationId: registration.id,
            consentFormVersionId: consentForm.id,
            consentStatus: "ACCEPTED",
            signerType: "PARTICIPANT",
            signerName: "John Tan",
            signerRelationship: "Self",
            recordedById: staff.id,
            signedAt: daysFromNow(-1),
            decisionAt: daysFromNow(-1),
            signatureObjectKey: "seed/signatures/john-tan.png",
            signatureSha256: crypto.createHash("sha256").update("seed-signature").digest("hex"),
            signatureMimeType: "image/png",
        },
        create: {
            id: IDS.acceptedConsent,
            participantId: participant.id,
            eventId: event.id,
            registrationId: registration.id,
            consentFormVersionId: consentForm.id,
            consentStatus: "ACCEPTED",
            signerType: "PARTICIPANT",
            signerName: "John Tan",
            signerRelationship: "Self",
            recordedById: staff.id,
            signedAt: daysFromNow(-1),
            decisionAt: daysFromNow(-1),
            signatureObjectKey: "seed/signatures/john-tan.png",
            signatureSha256: crypto.createHash("sha256").update("seed-signature").digest("hex"),
            signatureMimeType: "image/png",
        },
    });

    await prisma.registrationStatusHistory.upsert({
        where: { id: IDS.registrationHistory },
        update: {
            registrationId: registration.id,
            fromStatus: null,
            toStatus: "REGISTERED",
            changedById: staff.id,
            reason: "Created by development seed",
        },
        create: {
            id: IDS.registrationHistory,
            registrationId: registration.id,
            fromStatus: null,
            toStatus: "REGISTERED",
            changedById: staff.id,
            reason: "Created by development seed",
        },
    });

    await prisma.qRCodePass.upsert({
        where: { id: IDS.qrCode },
        update: {
            registrationId: registration.id,
            token: crypto.createHash("sha256").update("VSMS-SEED-QR-001").digest("hex"),
            expiresAt: daysFromNow(30),
            isActive: true,
            revokedAt: null,
            revokedBy: null,
            revokedReason: null,
        },
        create: {
            id: IDS.qrCode,
            registrationId: registration.id,
            token: crypto.createHash("sha256").update("VSMS-SEED-QR-001").digest("hex"),
            expiresAt: daysFromNow(30),
            isActive: true,
        },
    });

    return registration;
}

async function seedAuditData(staff, participant) {
    await prisma.auditLog.upsert({
        where: { id: IDS.auditLog },
        update: {
            userId: staff.id,
            action: "SEED_PARTICIPANT_REVIEWED",
            entityName: "Participant",
            entityId: participant.id,
            oldValue: null,
            newValue: { source: "development-seed" },
            ipAddress: "127.0.0.1",
            deviceName: "Seed workstation",
        },
        create: {
            id: IDS.auditLog,
            userId: staff.id,
            action: "SEED_PARTICIPANT_REVIEWED",
            entityName: "Participant",
            entityId: participant.id,
            newValue: { source: "development-seed" },
            ipAddress: "127.0.0.1",
            deviceName: "Seed workstation",
        },
    });

    await prisma.authAuditLog.upsert({
        where: { id: IDS.authAuditLog },
        update: {
            userId: staff.id,
            deviceId: IDS.authDevice,
            eventType: "LOGIN_SUCCESS",
            outcome: "SUCCESS",
            failureCategory: null,
            ipAddress: "127.0.0.1",
            userAgent: "Cryptix development seed",
            requestId: IDS.authRequest,
        },
        create: {
            id: IDS.authAuditLog,
            userId: staff.id,
            deviceId: IDS.authDevice,
            eventType: "LOGIN_SUCCESS",
            outcome: "SUCCESS",
            identifierHash: crypto.createHash("sha256").update(staff.email).digest("hex"),
            ipAddress: "127.0.0.1",
            userAgent: "Cryptix development seed",
            requestId: IDS.authRequest,
        },
    });
}

async function seedDevice(staff) {
    return prisma.device.upsert({
        where: { id: IDS.authDevice },
        update: {
            userId: staff.id,
            deviceName: "Seed workstation",
            status: "ACTIVE",
            lastSeenAt: new Date(),
        },
        create: {
            id: IDS.authDevice,
            userId: staff.id,
            deviceName: "Seed workstation",
            status: "ACTIVE",
            lastSeenAt: new Date(),
        },
    });
}

async function main() {
    const roles = await seedRoles();
    const { staff, created } = await seedStaff(roles);
    await seedPermissions(roles, staff);
    const event = await seedEvent();
    const participants = await seedParticipants(staff);
    await seedEmergencyContacts(staff, participants);
    const consentForm = await seedConsentForm(staff);
    const registration = await seedCompletedRegistration(
        staff,
        event,
        participants.registeredParticipant,
        consentForm,
    );
    await seedDevice(staff);
    await seedAuditData(staff, participants.registeredParticipant);

    console.log("Seed completed successfully.");
    console.log(`Staff: ${staff.email} (${created ? "created locally" : "existing local user"})`);
    console.log(`Event ID: ${event.id}`);
    console.log(`Registered participant ID: ${participants.registeredParticipant.id}`);
    console.log(`New-flow participant ID: ${participants.newParticipant.id}`);
    console.log(`Consent form ID: ${consentForm.id}`);
    console.log(`Registration ID: ${registration.id}`);
    console.log("The seed does not create a Cognito password or Cognito account.");
}

main()
    .catch((error) => {
        console.error("Seed failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
