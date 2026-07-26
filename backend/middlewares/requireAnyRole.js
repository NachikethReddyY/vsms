function requireAnyRole(...allowedRoles) {
    return (req, res, next) => {
        const roles = req.auth?.roles || [];
        const allowed = allowedRoles.some((role) => roles.includes(role));

        if (!allowed) {
            return res.status(403).json({
                error: "You do not have access to this resource",
                requestId: req.context?.requestId,
            });
        }

        next();
    };
}

module.exports = requireAnyRole;
