const userService = require("../services/userService");

// ==========================================
// Create Staff User
// POST /users
// ==========================================
exports.createUser = async (req, res, next) => {
  try {
    const newUser = await userService.createUser(req.body, req.auth.userId, req.context);

    return res.status(201).json({
      success: true,
      message: "Staff user created successfully",
      data: newUser,
    });
  } catch (error) {
    console.error("Create user error:", error);
    next(error);
  }
};

// ==========================================
// Get All Users
// GET /users
// ==========================================
exports.getUsers = async (req, res, next) => {
  try {
    const users = await userService.getAllUsers();

    return res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);
    next(error);
  }
};

// ==========================================
// Get User By ID
// GET /users/:id
// ==========================================
exports.getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await userService.getUserById(id);

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get user by ID error:", error);
    next(error);
  }
};

// ==========================================
// Update User
// PUT /users/:id
// ==========================================
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userData = req.body;

    const updatedUser = await userService.updateUser(id, userData, req.auth.userId, req.context);

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);
    next(error);
  }
};
