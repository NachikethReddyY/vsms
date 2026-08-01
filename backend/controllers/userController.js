const User = require("../models/userModel");

// ==========================================
// Create Staff User
// POST /users
// ==========================================
exports.createUser = async (req, res) => {
  try {
    const {
      fullName,
      email,
      employeeNumber,
      contactNumber,
      department,
      designation,
    } = req.body;

    // Validate input
    if (!fullName || !email || !employeeNumber) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, and employee number are required",
      });
    }

    // Check if email already exists
    const existingUser = await User.findByEmail(email);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    // Create staff user
    const newUser = await User.create({
      fullName,
      email,
      employeeNumber,
      contactNumber,
      department,
      designation,
      status: "ACTIVE",
    });

    return res.status(201).json({
      success: true,
      message: "Staff user created successfully",
      data: newUser,
    });
  } catch (error) {
    console.error("Create user error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// ==========================================
// Get All Users
// GET /users
// ==========================================
exports.getUsers = async (req, res) => {
  try {
    const users = await User.getAll();

    return res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// ==========================================
// Get User By ID
// GET /users/:id
// ==========================================
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get user by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// ==========================================
// Update User
// PUT /users/:id
// ==========================================
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userData = req.body;

    const existingUser = await User.findById(id);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const updatedUser = await User.update(id, userData);

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// ==========================================
// Delete User
// DELETE /users/:id
// ==========================================
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const existingUser = await User.findById(id);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await User.delete(id);

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};