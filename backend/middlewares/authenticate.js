const requireAuthentication = require("./requireAuthentication");
const logger = require("../utils/logger/logger"); // Optional: for logging unexpected errors or missing roles

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

/**
 * Enhanced middleware that authenticates the request and attaches 
 * a sanitized, structured user object to req.user.
 */
const attachUserMiddleware = (req, res, next) => {
  requireAuthentication(req, res, (error) => {
    if (error) {
      return next(error);
    }

    // Defensive check to ensure req.auth and user data actually exist
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Authentication context is missing.",
      });
    }

    try {
      // Attach normalized user info to request object
      req.user = {
        ...req.auth.user,
        userId: req.auth.userId,
        username: req.auth.user?.username || req.auth.email || "Unknown User",
        systemRole: systemRoleFor(req.auth.roles),
      };

      return next();
    } catch (err) {
      logger?.error("Failed to map user authentication context", { error: err.message });
      return res.status(500).json({
        success: false,
        message: "Internal server error during authentication processing.",
      });
    }
  });
};

module.exports = attachUserMiddleware;