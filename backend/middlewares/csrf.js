const env = require("../config/env");
const AppError = require("../errors/AppError");
const { timingSafeEqual } = require("../utils/crypto/security");
const { ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE } = require("../utils/http/httpCookies");

module.exports = (req, _res, next) => {
  const hasCookieCredentials = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
  const hasCsrfCookie = Boolean(req.cookies?.[CSRF_COOKIE]);
  const bearerMode = /^Bearer [A-Za-z0-9._~-]+$/.test(req.get("authorization") || "")
    && !hasCookieCredentials;
  if (bearerMode || (!hasCookieCredentials && !hasCsrfCookie)) return next();
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  const cookieToken = req.cookies[CSRF_COOKIE];
  const headerToken = req.get("x-csrf-token");
  if (!origin || !env.corsOrigins.includes(origin)) return next(new AppError(403, "INVALID_ORIGIN", "Request origin is not allowed"));
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return next(new AppError(403, "CROSS_SITE_REQUEST_BLOCKED", "Cross-site request blocked"));
  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) return next(new AppError(403, "CSRF_VALIDATION_FAILED", "CSRF validation failed"));
  return next();
};
