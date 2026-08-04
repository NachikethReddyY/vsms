const asyncHandler = require("./asyncHandler");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { verifyCognitoToken } = require("../utils/cognitoJwt");
const { ACCESS_COOKIE } = require("../utils/httpCookies");
const { rolesFromCognitoGroups } = require("../utils/staff");

module.exports = asyncHandler(async (req, _res, next) => {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.get("authorization") || "");
  const token = req.cookies?.[ACCESS_COOKIE] || match?.[1];
  if (!token) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");

  let payload;
  try {
    payload = await verifyCognitoToken(token, "access");
  } catch {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }
  if (typeof payload.sub !== "string") {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }

  const user = await prisma.user.findUnique({
    where: { cognitoSub: payload.sub },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }

  req.auth = {
    token,
    user,
    userId: user.id,
    email: user.email,
    roles: user.userRoles
      .map(({ role }) => role.roleName)
      .filter((role) => rolesFromCognitoGroups(payload).includes(role)),
  };
  next();
});
