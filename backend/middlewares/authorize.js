const AppError = require("../errors/AppError");

const requireSystemRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.systemRole)) {
    return next(new AppError(403, "FORBIDDEN", "You do not have permission to perform this action"));
  }
  return next();
};

module.exports = { requireSystemRole };
