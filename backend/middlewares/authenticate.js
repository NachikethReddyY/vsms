const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { verifyAccessToken } = require("../utils/tokens");

module.exports = async (req, _res, next) => {
  try {
    const header = req.get("authorization") || "";
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
    if (!match) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");

    let payload;
    try {
      payload = verifyAccessToken(match[1]);
    } catch (_error) {
      throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
    }

    if (payload.type !== "access" || typeof payload.sub !== "string") {
      throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
    }

    // Matches your Prisma User model schema fields (id, email, fullName, status)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub }, 
      select: { id: true, email: true, fullName: true, status: true },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};