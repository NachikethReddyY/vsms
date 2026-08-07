const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

process.env.NODE_ENV = "test";
process.env.LOCAL_HTTPS = "false";
process.env.PUBLIC_SIGNUP_ENABLED = "false";
process.env.COGNITO_REGION = "ap-southeast-1";
process.env.COGNITO_USER_POOL_ID = "ap-southeast-1_vsms_test";
process.env.COGNITO_APP_CLIENT_ID = "vsms-integration-client";
process.env.COGNITO_DOMAIN = "https://auth.tests.vsms.local";
process.env.COGNITO_REDIRECT_URI = "https://localhost:5173/auth/callback";
process.env.COGNITO_LOGOUT_URI = "https://localhost:5173/login";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const signingKeyId = "vsms-integration-key";
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: signingKeyId,
  use: "sig",
  alg: "RS256",
};
const issuer = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const originalFetch = global.fetch;

global.fetch = async (input, init) => {
  if (String(input) === `${issuer}/.well-known/jwks.json`) {
    return { ok: true, json: async () => ({ keys: [jwk] }) };
  }
  if (!originalFetch) throw new Error(`Unexpected integration-test fetch: ${String(input)}`);
  return originalFetch(input, init);
};

const prisma = require("../prisma/prismaClient");

const ROLE_ALIASES = {
  ADMIN: "ADMINISTRATOR",
  STAFF: "REGISTRATION_OFFICER",
};
const COGNITO_GROUPS = {
  ADMINISTRATOR: "Admin",
  EVENT_MANAGER: "EventManager",
  REGISTRATION_OFFICER: "RegistrationOfficer",
  SCREENER: "Screener",
  REVIEWER: "Reviewer",
  SUPPORT: "Support",
};

// Mirrors backend/prisma/seed.js so role-based permission checks behave the
// same on a freshly migrated (unseeded) CI database and a seeded dev database.
const TEST_PERMISSIONS = [
  "participants:read",
  "participants:write",
  "consents:record",
  "registrations:create",
  "registrations:read",
  "audit:read",
];

const grantRolePermissions = async (roleName, roleId) => {
  for (const permissionName of TEST_PERMISSIONS) {
    if (roleName !== "ADMINISTRATOR" && permissionName === "audit:read") continue;
    const permission = await prisma.permission.upsert({
      where: { permissionName },
      update: {},
      create: { permissionName, description: `Allows ${permissionName}` },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      update: {},
      create: { roleId, permissionId: permission.id },
    });
  }
};

const applicationRoleFor = (role) => ROLE_ALIASES[role] || role;
const systemRoleFor = (role) => role === "ADMINISTRATOR"
  ? "ADMIN"
  : role === "EVENT_MANAGER" ? "EVENT_MANAGER" : "STAFF";

const ensureTestUser = async (requestedRole = "EVENT_MANAGER", label = requestedRole) => {
  const applicationRole = applicationRoleFor(requestedRole);
  if (!COGNITO_GROUPS[applicationRole]) throw new Error(`Unsupported integration-test role: ${requestedRole}`);
  const slug = String(label).toLowerCase().replaceAll("_", "-").replace(/[^a-z0-9-]/g, "");
  const email = `${slug}@tests.vsms.local`;
  const role = await prisma.role.upsert({
    where: { roleName: applicationRole },
    update: {},
    create: { roleName: applicationRole, description: `${applicationRole} integration role` },
  });
  await grantRolePermissions(applicationRole, role.id);
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({
      where: { id: existing.id },
      data: {
        cognitoSub: existing.cognitoSub || crypto.randomUUID(),
        username: `test-${slug}`,
        fullName: `Test ${label}`,
        sysRole: systemRoleFor(applicationRole),
        status: "ACTIVE",
        approvalState: "APPROVED",
        accessState: "ENABLED",
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    })
    : await prisma.user.create({
      data: {
        cognitoSub: crypto.randomUUID(),
        username: `test-${slug}`,
        email,
        fullName: `Test ${label}`,
        employeeNumber: `T-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        sysRole: systemRoleFor(applicationRole),
        status: "ACTIVE",
        approvalState: "APPROVED",
        accessState: "ENABLED",
      },
    });
  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const saved = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { userRoles: { include: { role: true } } },
  });
  return { ...saved, userId: saved.id };
};

const accessTokenFor = (user, roles) => {
  const applicationRoles = (roles || user.userRoles?.map(({ role }) => role.roleName) || [])
    .map(applicationRoleFor);
  return jwt.sign(
    {
      token_use: "access",
      client_id: process.env.COGNITO_APP_CLIENT_ID,
      username: user.username,
      auth_time: Math.floor(Date.now() / 1000),
      "cognito:groups": applicationRoles.map((role) => COGNITO_GROUPS[role]),
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: signingKeyId,
      issuer,
      subject: user.cognitoSub,
      expiresIn: "10m",
    },
  );
};

const authHeader = (user, roles) => ({ Authorization: `Bearer ${accessTokenFor(user, roles)}` });

const cookieHeader = (response) => (response.headers["set-cookie"] || [])
  .filter((cookie) => !cookie.split(";", 1)[0].endsWith("="))
  .map((cookie) => cookie.split(";")[0])
  .join("; ");

module.exports = {
  ensureTestUser,
  accessTokenFor,
  authHeader,
  cookieHeader,
  prisma,
  issuer,
};
