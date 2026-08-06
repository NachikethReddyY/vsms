const AppError = require("../errors/AppError");

function isApprovedAccount(user) {
  if (!user || user.deprovisionedAt) return false;
  const approvalState = user.approvalState ?? (user.status === "ACTIVE" ? "APPROVED" : "PENDING");
  const accessState = user.accessState ?? (user.status === "SUSPENDED" ? "SUSPENDED" : user.status === "ACTIVE" ? "ENABLED" : "DISABLED");
  return approvalState === "APPROVED" && accessState === "ENABLED" && user.status === "ACTIVE";
}

function requireApprovedAccount(req, _res, next) {
  if (!isApprovedAccount(req.auth?.user)) {
    return next(new AppError(403, "ACCOUNT_NOT_OPERATIONAL", "Account approval and enabled access are required"));
  }
  return next();
}

requireApprovedAccount.isApprovedAccount = isApprovedAccount;
module.exports = requireApprovedAccount;
