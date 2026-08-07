const userService = require("../services/userService");

function splitProviderOperation(result) {
  const { providerOperation, ...data } = result;
  return { data, providerOperation };
}

// ==========================================
// Create Staff User
// POST /users
// ==========================================
exports.createUser = async (req, res, next) => {
  try {
    const result = splitProviderOperation(await userService.createUser(req.body, req.auth.userId, req.context));

    return res.status(result.providerOperation?.pending ? 202 : 201).json({
      success: true,
      message: result.providerOperation?.pending ? "Staff user created; identity provider synchronization is pending" : "Staff user created successfully",
      data: result.data,
      ...(result.providerOperation ? { providerOperation: result.providerOperation } : {}),
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

    const result = splitProviderOperation(await userService.updateUser(id, userData, req.auth.userId, req.context));

    return res.status(result.providerOperation?.pending ? 202 : 200).json({
      success: true,
      message: result.providerOperation?.pending ? "User updated; identity provider synchronization is pending" : "User updated successfully",
      data: result.data,
      ...(result.providerOperation ? { providerOperation: result.providerOperation } : {}),
    });
  } catch (error) {
    console.error("Update user error:", error);
    next(error);
  }
};
