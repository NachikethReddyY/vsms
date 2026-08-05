const { createAuthAuditLog } = require("../utils/AuthAudit");

function buildRoleGuard(allowedRoles, denyAdministrator) {
    return async (req, res, next) => {
        const roles = req.auth?.roles || [];
        const allowed = (!denyAdministrator || !roles.includes("ADMINISTRATOR"))
            && allowedRoles.some((role) => roles.includes(role));

        if (!allowed) {
            await createAuthAuditLog({
                userId: req.auth?.userId || null,
                eventType: "ACCESS_DENIED",
                outcome: "DENIED",
                identifier: req.auth?.email || null,
                context: req.context,
            }).catch(() => {});
            return res.status(403).json({
                error: "You do not have access to this resource",
                requestId: req.context?.requestId,
            });
        }

        next();
    };
}

function requireAnyRole(...allowedRoles) {
    return buildRoleGuard(allowedRoles, false);
}

requireAnyRole.operational = (...allowedRoles) => buildRoleGuard(allowedRoles, true);

module.exports = requireAnyRole;
