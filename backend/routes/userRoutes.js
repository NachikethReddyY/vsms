const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");

// ==========================================
// Create Staff User
// POST /users
// ==========================================
router.post("/", userController.createUser);

// ==========================================
// Get All Users
// GET /users
// ==========================================
router.get("/", userController.getUsers);

module.exports = router;