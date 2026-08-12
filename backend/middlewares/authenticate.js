const requireAuthentication = require("./requireAuthentication");
const logger = require("../utils/logging/logger/logger"); // Optional: for logging unexpected errors or missing roles
const requireApprovedAccount = require("./requireApprovedAccount");

/**
 * Maps high-level security roles to the internal system role structure.
 * @param {string[]} roles - Array of roles assigned to the authenticated user.
 * @returns {string} The corresponding system role.
 */
const systemRoleFor = (roles = []) => {
  if (!Array.isArray(roles)) return "STAFF";
  if (roles.includes("ADMINISTRATOR")) return "ADMIN";
  if (roles.includes("EVENT_MANAGER")) return "EVENT_MANAGER";
  return "STAFF";
};

module.exports = (req, res, next) => requireAuthentication(req, res, (error) => {
  if (error) return next(error);
  return requireApprovedAccount(req, res, (approvalError) => {
    if (approvalError) return next(approvalError);
    req.user = {
      ...req.auth.user,
      userId: req.auth.userId,
      username: req.auth.user.username || req.auth.email,
      systemRole: systemRoleFor(req.auth.roles),
      roles: req.auth.roles,
    };
    return next();
  });
});
