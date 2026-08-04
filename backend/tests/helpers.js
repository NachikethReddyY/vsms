const bcrypt = require("bcrypt");
const prisma = require("../prisma/prismaClient");

const PASSWORD = "Test-Only-Secure-Password-2026!";

const ensureTestUser = async (systemRole = "EVENT_MANAGER") => {
  const email = `${systemRole.toLowerCase().replaceAll("_", "-")}@tests.vsms.local`;
  const username = `test-${systemRole.toLowerCase().replaceAll("_", "-")}`;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const roleName = systemRole === "ADMIN" ? "ADMINISTRATOR" : systemRole === "STAFF" ? "REGISTRATION_OFFICER" : systemRole;
  const role = await prisma.role.upsert({
    where: { roleName },
    update: {},
    create: { roleName },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: { username, sysRole: systemRole, status: "ACTIVE", failedLoginAttempts: 0, lockedUntil: null },
    create: {
      username,
      email,
      fullName: `Test ${systemRole}`,
      employeeNumber: `TEST-${systemRole}`,
      sysRole: systemRole,
      status: "ACTIVE",
    },
  });
  await prisma.userCredential.upsert({
    where: { userId: user.id },
    update: { passwordHash },
    create: { userId: user.id, passwordHash },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  return user;
};

const cookieHeader = (response) => response.headers["set-cookie"]
  .filter((cookie) => !cookie.split(";", 1)[0].endsWith("="))
  .map((cookie) => cookie.split(";")[0])
  .join("; ");

module.exports = { PASSWORD, ensureTestUser, cookieHeader, prisma };
