const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");
const authenticate = require("../middlewares/authenticate");
const { requireSystemRole } = require("../middlewares/authorize");

router.get("/", authenticate, requireSystemRole("ADMIN"), userController.getUsers);

module.exports = router;
