const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const { rateLimit } = require("../middlewares/security");

router.get("/config-status", authController.configStatus);

// Added /login route to satisfy the test contract
router.post("/login", rateLimit({ windowMs: 15 * 60_000, max: 30 }, authController.login || authController.localLogin));

router.get("/authorize", rateLimit({ windowMs: 15 * 60_000, max: 30 }), authController.authorize);
router.get("/callback", rateLimit({ windowMs: 15 * 60_000, max: 30 }), authController.callback);
router.post("/refresh", rateLimit({ windowMs: 60_000, max: 30 }), authController.refresh);
router.get("/me", requireAuthentication, authController.me);
router.post("/logout", authController.logout);
router.post("/global-logout", authController.logout);
router.post("/change-password", requireAuthentication, authController.changePassword);

module.exports = router;