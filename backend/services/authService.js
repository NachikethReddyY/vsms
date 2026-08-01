const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../prisma/prismaClient");
const env = require("../config/env");
const AppError = require("../errors/AppError");
const { signAccessToken } = require("../utils/tokens");
const { randomToken, sha256, hashUserAgent } = require("../utils/security");

const DUMMY_HASH = "$2b$12$EE6ZpTcEn105IV6.OlGeS.KQJx73gDqfJA7NnE7NDZGy75XXOa9hK";
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "strict", path: "/auth" };
const CSRF_COOKIE_OPTIONS = { httpOnly: false, secure: true, sameSite: "strict", path: "/" };
const LEGACY_CSRF_COOKIE_OPTIONS = { ...CSRF_COOKIE_OPTIONS, path: "/auth" };

const publicUser = (user) => ({
  userId: user.userId,
  username: user.username,
  email: user.email,
  systemRole: user.systemRole,
  status: user.status,
  createdAt: user.createdAt,
});

const buildSessionData = (userId, familyId, token, req) => ({
  userId,
  familyId,
  tokenHash: sha256(token),
  expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000),
  userAgentHash: hashUserAgent(req.get("user-agent")),
  networkHint: sha256(req.ip || "unknown").slice(0, 32),
});

const issueCookies = (res, refreshToken, csrfToken) => {
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 86400000;
  res.clearCookie("vsms_csrf", LEGACY_CSRF_COOKIE_OPTIONS);
  res.cookie("vsms_refresh", refreshToken, { ...COOKIE_OPTIONS, maxAge });
  res.cookie("vsms_csrf", csrfToken, { ...CSRF_COOKIE_OPTIONS, maxAge });
};

const clearCookies = (res) => {
  res.clearCookie("vsms_refresh", COOKIE_OPTIONS);
  res.clearCookie("vsms_csrf", CSRF_COOKIE_OPTIONS);
  res.clearCookie("vsms_csrf", LEGACY_CSRF_COOKIE_OPTIONS);
};

const signup = async ({ email, password }) => {
  if (!env.publicSignupEnabled) {
    throw new AppError(404, "NOT_FOUND", "Resource not found");
  }

  const localPart = email.split("@", 1)[0]
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 80);
  const username = `${localPart || "staff"}-${crypto.randomBytes(6).toString("hex")}`;
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const user = await prisma.user.create({
      data: { username, email, passwordHash, systemRole: "STAFF", status: "ACTIVE" },
    });
    return { user: publicUser(user) };
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError(409, "ACCOUNT_EXISTS", "An account cannot be created with these details");
    }
    throw error;
  }
};

const recordFailure = async (userId) => prisma.$transaction(async (tx) => {
  const failed = await tx.user.update({ where: { userId }, data: { failedLoginAttempts: { increment: 1 } }, select: { failedLoginAttempts: true } });
  if (failed.failedLoginAttempts >= 5) {
    await tx.user.update({ where: { userId }, data: { lockedUntil: new Date(Date.now() + 15 * 60000) } });
  }
});

const login = async ({ identifier, password }, req, res) => {
  const user = await prisma.user.findFirst({ where: { OR: [{ username: identifier }, { email: identifier }] } });
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  const locked = user?.lockedUntil && user.lockedUntil > new Date();
  if (!user || !passwordMatches || user.status !== "ACTIVE" || locked) {
    if (user && !passwordMatches && user.status === "ACTIVE") await recordFailure(user.userId);
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password");
  }

  const refreshToken = randomToken();
  const csrfToken = randomToken();
  const familyId = crypto.randomUUID();
  const updatedUser = await prisma.$transaction(async (tx) => {
    const current = await tx.user.update({ where: { userId: user.userId }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await tx.refreshSession.create({ data: buildSessionData(user.userId, familyId, refreshToken, req) });
    return current;
  });
  issueCookies(res, refreshToken, csrfToken);
  return { accessToken: signAccessToken(updatedUser), csrfToken, user: publicUser(updatedUser) };
};

const revokeFamily = async (familyId) => {
  const detectedAt = new Date();
  await prisma.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: detectedAt, reuseDetectedAt: detectedAt } });
};

const refresh = async (req, res) => {
  const suppliedToken = req.cookies.vsms_refresh;
  if (!suppliedToken) throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  const existing = await prisma.refreshSession.findUnique({ where: { tokenHash: sha256(suppliedToken) }, include: { user: true } });
  if (!existing || existing.expiresAt <= new Date() || existing.user.status !== "ACTIVE") {
    clearCookies(res);
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }
  if (existing.rotatedAt || existing.replacedById || existing.revokedAt) {
    await revokeFamily(existing.familyId);
    clearCookies(res);
    throw new AppError(401, "SESSION_REUSE_DETECTED", "Session is invalid or expired");
  }

  const nextToken = randomToken();
  const nextCsrf = randomToken();
  try {
    await prisma.$transaction(async (tx) => {
      const replacement = await tx.refreshSession.create({ data: buildSessionData(existing.userId, existing.familyId, nextToken, req) });
      const changed = await tx.refreshSession.updateMany({
        where: { refreshSessionId: existing.refreshSessionId, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: new Date(), lastUsedAt: new Date(), replacedById: replacement.refreshSessionId },
      });
      if (changed.count !== 1) throw new AppError(401, "SESSION_REUSE_DETECTED", "Session is invalid or expired");
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "SESSION_REUSE_DETECTED") {
      await revokeFamily(existing.familyId);
      clearCookies(res);
    }
    throw error;
  }
  issueCookies(res, nextToken, nextCsrf);
  return { accessToken: signAccessToken(existing.user), csrfToken: nextCsrf, user: publicUser(existing.user) };
};

const logout = async (req, res) => {
  const suppliedToken = req.cookies.vsms_refresh;
  if (suppliedToken) {
    const session = await prisma.refreshSession.findUnique({ where: { tokenHash: sha256(suppliedToken) } });
    if (session) await prisma.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  clearCookies(res);
};

module.exports = { signup, login, refresh, logout };
