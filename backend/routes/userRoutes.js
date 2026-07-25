const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");
const authenticate = require("../middlewares/authenticate"); 
const { requireSystemRole } = require("../middlewares/authorize"); 
const { validateExternalUrl } = require("../middlewares/validateExternalUrl"); // 1. Import it

// Only ADMIN users can view all users
router.get("/", authenticate, requireSystemRole("ADMIN"), userController.getUsers);

// ADMIN or EVENT_MANAGER can access
// 2. Add validateExternalUrl here if POST / users accepts an external URL payload
router.post(
  "/", 
  authenticate, 
  requireSystemRole("ADMIN", "EVENT_MANAGER"), 
  validateExternalUrl, // Runs after auth and roles, but before your controller
  userController.createUser
);

module.exports = router;