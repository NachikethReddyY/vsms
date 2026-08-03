const asyncHandler = require("./asyncHandler");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { verifyAccessToken } = require("../utils/tokens");
const { verifyCognitoToken } = require("../utils/cognitoJwt");
const { rolesFromCognitoGroups } = require("../utils/roles");
const { ACCESS_COOKIE } = require("../utils/httpCookies");

module.exports = asyncHandler(async (req, _res, next) => {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.get("authorization") || "");
  const cookieToken = req.cookies?.[ACCESS_COOKIE];
  const token = match?.[1] || cookieToken;
  if (!token) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");

  let payload;
  try {
    payload = match ? verifyAccessToken(token) : await verifyCognitoToken(token, "access");
  } catch {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }
  if (typeof payload.sub !== "string" || (match && payload.type !== "access")) {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }

  const user = await prisma.user.findUnique({
    where: match ? { id: payload.sub } : { cognitoSub: payload.sub },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }

  const localRoles = user.userRoles.map(({ role }) => role.roleName);
  const roles = match
    ? localRoles
    : localRoles.filter((role) => rolesFromCognitoGroups(payload).includes(role));
  if (roles.length === 0) {
    throw new AppError(403, "FORBIDDEN", "Cognito group membership does not grant an application role");
  }

  req.auth = {
    token,
    user,
    userId: user.id,
    email: user.email,
    roles,
  };
  next();
});
