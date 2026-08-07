const { createAuthAuditLog } = require("../utils/audit");
const { isApprovedAccount } = require("./requireApprovedAccount");

/**
 * Permission-based authorization guard. Unlike requireAnyRole (which checks
 * Cognito group membership / local role names), this middleware enforces the
 * `Permission`/`RolePermission` tables: the effective permission names are
 * attached to `req.auth.permissions` by requireAuthentication.
 *
 * Access is granted when the caller holds ANY of the required permissions.
 */
function requirePermission(...requiredPermissions) {
  return async (req, res, next) => {
    const permissions = req.auth?.permissions || [];
    const allowed = isApprovedAccount(req.auth?.user)
      && requiredPermissions.some((permission) => permissions.includes(permission));

    if (!allowed) {
      await createAuthAuditLog({
        userId: req.auth?.userId || null,
        eventType: "ACCESS_DENIED",
        outcome: "DENIED",
        identifier: req.auth?.email || null,
        context: req.context,
      }).catch(() => {});
      return res.status(403).json({
        error: "You do not have permission to perform this action",
        requestId: req.context?.requestId,
      });
    }

    next();
  };
}

module.exports = requirePermission;
