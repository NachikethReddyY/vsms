const User = require("../models/userModel");

exports.getUsers = async (_req, res) => {
  const users = await User.getAll();
  res.json(users);
};
