const authService = require("../services/authService");

exports.signup = async (req, res) => res.status(201).json(await authService.signup(req.body));
exports.login = async (req, res) => res.status(200).json(await authService.login(req.body, req, res));
exports.refresh = async (req, res) => res.status(200).json(await authService.refresh(req, res));
exports.logout = async (req, res) => {
  await authService.logout(req, res);
  res.status(204).end();
};
