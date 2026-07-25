const jwt = require("jsonwebtoken");
const AppError = require("../errors/AppError");

/**
 * Authentication Middleware
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.get("authorization") || req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next(new AppError(401, "UNAUTHORIZED", "Access token required."));
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "fallback_secret",
    (err, decodedUser) => {
      if (err) {
        return next(
          new AppError(403, "INVALID_SESSION", "Invalid or expired token.")
        );
      }

      req.user = decodedUser;
      next();
    }
  );
};

/**
 * Role Authorization Middleware
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, "UNAUTHORIZED", "Authentication required."));
    }

    // Supports both systemRole and role property names
    const userRole = req.user.systemRole || req.user.role;

    if (!userRole || !allowedRoles.includes(userRole)) {
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action."
        )
      );
    }

    next();
  };
};

module.exports = {
  // Primary exports
  authenticateToken,
  authorizeRoles,

  // Export aliases for alternative import syntaxes across routes
  authenticate: authenticateToken,
  requireSystemRole: authorizeRoles,
};