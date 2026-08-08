const asyncHandler = require("../middlewares/asyncHandler");
const accountService = require("../services/accountService");
const { maintainLifecycleEmail } = require("../services/accountLifecycleNotificationService");

function sendAccountResult(res, result) {
  const { providerOperation, ...account } = result;
  return res.status(providerOperation?.pending ? 202 : 200).json({
    account,
    ...(providerOperation ? { providerOperation } : {}),
  });
}

exports.me = asyncHandler(async (req, res) => {
  res.json({ account: await accountService.getCurrentAccount(req.auth.userId) });
});

exports.updateMe = asyncHandler(async (req, res) => {
  res.json({ account: await accountService.updateCurrentAccount(req.auth.userId, req.body, req.context) });
});

exports.list = asyncHandler(async (req, res) => {
  res.json(await accountService.listAccounts(req.query));
});

exports.detail = asyncHandler(async (req, res) => {
  res.json({ account: await accountService.getAccount(req.params.accountId) });
});

exports.approve = asyncHandler(async (req, res) => {
  const account = await accountService.decideApproval(
    req.params.accountId, "APPROVED", req.body.reason, req.auth.userId, req.context,
  );
  res.json({ account });
});

exports.reject = asyncHandler(async (req, res) => {
  const account = await accountService.decideApproval(
    req.params.accountId, "REJECTED", req.body.reason, req.auth.userId, req.context,
  );
  res.json({ account });
});

exports.suspend = asyncHandler(async (req, res) => {
  const result = await accountService.changeAccess(
    req.params.accountId, "suspend", req.body.reason, req.auth.userId, req.context,
  );
  sendAccountResult(res, result);
});

exports.reactivate = asyncHandler(async (req, res) => {
  const result = await accountService.changeAccess(
    req.params.accountId, "reactivate", req.body.reason, req.auth.userId, req.context,
  );
  sendAccountResult(res, result);
});

exports.revokeSessions = asyncHandler(async (req, res) => {
  sendAccountResult(res, await accountService.revokeSessions(req.params.accountId, req.auth.userId, req.context));
});

exports.deprovision = asyncHandler(async (req, res) => {
  const result = await accountService.deprovision(
    req.params.accountId, req.body.reason, req.auth.userId, req.context,
  );
  sendAccountResult(res, result);
});

exports.resendLifecycle = asyncHandler(async (req, res) => {
  res.json(await accountService.resendLifecycle(req.params.accountId, req.auth.userId, req.context));
});

exports.maintainLifecycleEmail = asyncHandler(async (req, res) => {
  const delivery = await maintainLifecycleEmail(req.params.deliveryId, req.body.action, req.body.reason, req.auth.userId, req.context);
  if (!delivery) return res.status(404).json({ code: "LIFECYCLE_EMAIL_NOT_FOUND", message: "Lifecycle email was not found" });
  res.json({ delivery });
});
