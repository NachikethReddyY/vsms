const asyncHandler = require("../middlewares/asyncHandler");
const authService = require("../services/authService");

// Cognito is intentionally disabled for development. Local credentials use
// the existing bcrypt/JWT session service until the production auth cutover.
exports.login = asyncHandler(async (req, res) => {
  res.json(await authService.login(req.body, req, res));
});

exports.refresh = asyncHandler(async (req, res) => {
  res.json(await authService.refresh(req, res));
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ user: authService.publicUser(req.auth.user) });
});

exports.logout = asyncHandler(async (req, res) => {
  await authService.logout(req, res);
  res.status(204).end();
});
