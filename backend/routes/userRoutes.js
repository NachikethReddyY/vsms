const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");
const authenticate = require("../middlewares/authenticate"); // Your auth middleware
const { requireSystemRole } = require("../middlewares/authorize"); // Your new authorize middleware

// Only ADMIN users can view all users
router.get("/", authenticate, requireSystemRole("ADMIN"), userController.getUsers);

// ADMIN or EVENT_MANAGER can access
router.post("/", authenticate, requireSystemRole("ADMIN", "EVENT_MANAGER"), userController.createUser);

module.exports = router;