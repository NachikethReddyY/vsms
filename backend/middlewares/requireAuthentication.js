const asyncHandler = require("./asyncHandler");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { verifyAccessToken } = require("../utils/auth/tokens");
const { verifyCognitoToken } = require("../utils/auth/cognitoJwt");
const { ACCESS_COOKIE } = require("../utils/http/httpCookies");
const { rolesFromCognitoGroups } = require("../utils/auth/staff");
const { sessionValidity } = require("../utils/auth/sessionValidity");

module.exports = asyncHandler(async (req, _res, next) => {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.get("authorization") || "");
  const cookieToken = req.cookies?.[ACCESS_COOKIE];
  const token = cookieToken || match?.[1];
  if (!token) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");

  let payload;
  let cognitoToken = true;
  try {
    payload = await verifyCognitoToken(token, "access");
  } catch {
    if (cookieToken || process.env.NODE_ENV !== "test") {
      throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
    }
    try {
      payload = verifyAccessToken(token);
      cognitoToken = false;
    } catch {
      throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
    }
  }
  if (typeof payload.sub !== "string" || (!cognitoToken && payload.type !== "access")) {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }

  const user = await prisma.user.findUnique({
    where: cognitoToken ? { cognitoSub: payload.sub } : { id: payload.sub },
    include: {
      userRoles: {
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user || user.status === "DISABLED" || user.accessState === "DISABLED" || user.deprovisionedAt) {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }
  const validity = sessionValidity(user, payload, { allowLocalIatFallback: !cognitoToken });
  if (!validity.valid) {
    const code = validity.reason === "SESSION_REVOKED" ? "SESSION_REVOKED" : "INVALID_SESSION";
    throw new AppError(401, code, code === "SESSION_REVOKED" ? "Session has been revoked" : "Session is invalid or expired");
  }

  const localRoles = user.userRoles.map(({ role }) => role.roleName);
  const roles = cognitoToken
    ? localRoles.filter((role) => rolesFromCognitoGroups(payload).includes(role))
    : localRoles;
  const effectiveRoles = new Set(roles);
  const permissions = [
    ...new Set(
      user.userRoles
        .filter(({ role }) => effectiveRoles.has(role.roleName))
        .flatMap(({ role }) => (role.rolePermissions || []).map(({ permission }) => permission.permissionName)),
    ),
  ];

  req.auth = {
    token,
    user,
    userId: user.id,
    email: user.email,
    roles,
    permissions,
    authenticatedAt: Number(payload.auth_time || payload.iat),
  };
  next();
});
