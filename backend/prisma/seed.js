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

async function main() {
  const roles = await seedRoles();
  const staff = await seedStaff(roles);
  await seedPermissions(roles, staff);
  await seedConsentForm(staff);
  console.log(`Seeded roles, permissions, consent form, and staff profile for ${staff.email}.`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
