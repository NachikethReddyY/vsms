const { createAuthAuditLog } = require("../utils/AuthAudit");

function requireAnyRole(...allowedRoles) {
    return async (req, res, next) => {
        const roles = req.auth?.roles || [];
        const allowed = allowedRoles.some((role) => roles.includes(role));

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

module.exports = requireAnyRole;
