const AppError = require("../errors/AppError");
const { createAuthAuditLog } = require("../utils/logging/audit");

const DEFAULT_MAX_AGE_SECONDS = 15 * 60;

function requireRecentAuthentication(maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS) {
  return async (req, _res, next) => {
    const authenticatedAt = Number(req.auth?.authenticatedAt);
    const ageSeconds = Math.floor(Date.now() / 1000) - authenticatedAt;
    const recent = Number.isFinite(authenticatedAt)
      && ageSeconds >= 0
      && ageSeconds <= maxAgeSeconds;

    if (!recent) {
      await createAuthAuditLog({
        userId: req.auth?.userId || null,
        eventType: "RECENT_AUTHENTICATION_REQUIRED",
        outcome: "DENIED",
        identifier: req.auth?.email || null,
        context: req.context,
      }).catch(() => {});
      return next(new AppError(
        401,
        "RECENT_AUTHENTICATION_REQUIRED",
        "Sign in again before performing this sensitive action",
      ));
    }

    return next();
  };
}

requireRecentAuthentication.DEFAULT_MAX_AGE_SECONDS = DEFAULT_MAX_AGE_SECONDS;

module.exports = requireRecentAuthentication;
