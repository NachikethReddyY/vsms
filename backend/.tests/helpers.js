const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");

const PASSWORD = "Test-Only-Secure-Password-2026!";

const ensureTestUser = async (systemRole = "EVENT_MANAGER", suffix = "") => {
  const key = `${systemRole.toLowerCase().replaceAll("_", "-")}${suffix ? `-${suffix}` : ""}`;
  const email = `${key}@tests.vsms.local`;
  const username = `test-${key}`;
  return prisma.user.upsert({
    where: { email },
    update: { username, passwordHash: await bcrypt.hash(PASSWORD, 4), systemRole, status: "ACTIVE", failedLoginAttempts: 0, lockedUntil: null },
    create: { userId: crypto.randomUUID(), username, email, passwordHash: await bcrypt.hash(PASSWORD, 4), systemRole, status: "ACTIVE" },
  });
};

const cookieHeader = (response) => [...response.headers["set-cookie"].reduce((cookies, cookie) => {
  if (!cookie.includes("Max-Age=0")) cookies.set(cookie.split("=", 1)[0], cookie.split(";")[0]);
  return cookies;
}, new Map()).values()].join("; ");

module.exports = { PASSWORD, ensureTestUser, cookieHeader, prisma };
