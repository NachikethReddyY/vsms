const authService = require("../services/authService");

exports.signup = async (req, res, next) => {
  try {
    const result = await authService.signup(req.body);
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    // FIX: Match the order of parameters required by authService.login({ identifier, password }, req, res)
    const result = await authService.login(req.body, req, res);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

exports.refresh = async (req, res, next) => {
  try {
    const result = await authService.refresh(req, res);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    await authService.logout(req, res);
    
    // Return a standard 200 JSON response so the client receives a clear payload
    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    next(error);
  }
};