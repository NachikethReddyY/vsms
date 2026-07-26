const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");

const PASSWORD = "Test-Only-Secure-Password-2026!";

const ensureTestUser = async (systemRole = "EVENT_MANAGER") => {
  const email = `${systemRole.toLowerCase().replaceAll("_", "-")}@tests.vsms.local`;
  const username = `test-${systemRole.toLowerCase().replaceAll("_", "-")}`;
  return prisma.user.upsert({
    where: { email },
    update: { username, passwordHash: await bcrypt.hash(PASSWORD, 4), systemRole, status: "ACTIVE", failedLoginAttempts: 0, lockedUntil: null },
    create: { userId: crypto.randomUUID(), username, email, passwordHash: await bcrypt.hash(PASSWORD, 4), systemRole, status: "ACTIVE" },
  });
};

const cookieHeader = (response) => response.headers["set-cookie"]
  .filter((cookie) => !cookie.split(";", 1)[0].endsWith("="))
  .map((cookie) => cookie.split(";")[0])
  .join("; ");

module.exports = { PASSWORD, ensureTestUser, cookieHeader, prisma };
