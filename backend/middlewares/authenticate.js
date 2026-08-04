const requireAuthentication = require("./requireAuthentication");

const systemRoleFor = (roles) => {
  if (roles.includes("ADMINISTRATOR")) return "ADMIN";
  if (roles.includes("EVENT_MANAGER")) return "EVENT_MANAGER";
  return "STAFF";
};

module.exports = (req, res, next) => requireAuthentication(req, res, (error) => {
  if (error) return next(error);
  req.user = {
    ...req.auth.user,
    userId: req.auth.userId,
    username: req.auth.user.username || req.auth.email,
    systemRole: systemRoleFor(req.auth.roles),
    roles: req.auth.roles,
  };
  return next();
});
