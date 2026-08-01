const asyncHandler = require("./asyncHandler");
const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { verifyAccessToken } = require("../utils/tokens");

module.exports = asyncHandler(async (req, _res, next) => {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.get("authorization") || "");
  if (!match) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");

  let payload;
  try {
    payload = verifyAccessToken(match[1]);
  } catch {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }
  if (payload.type !== "access" || typeof payload.sub !== "string") {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
  }

  req.auth = {
    token: match[1],
    user,
    userId: user.id,
    email: user.email,
    roles: user.userRoles.map(({ role }) => role.roleName),
  };
  next();
});
