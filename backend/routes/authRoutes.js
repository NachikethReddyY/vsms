const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const { rateLimit } = require("../middlewares/security");

router.get("/config-status", authController.configStatus);
router.post("/login", rateLimit({ windowMs: 15 * 60_000, max: 10 }), authController.login);
router.post("/respond-to-challenge", rateLimit({ windowMs: 15 * 60_000, max: 10 }), authController.respondToChallenge);
router.post("/refresh", rateLimit({ windowMs: 60_000, max: 30 }), authController.refresh);
router.get("/me", requireAuthentication, authController.me);
router.post("/logout", requireAuthentication, authController.logout);
router.post("/global-logout", requireAuthentication, authController.logout);
router.post("/forgot-password", authController.forgotPassword);
router.post("/confirm-forgot-password", authController.confirmForgotPassword);
router.post("/change-password", requireAuthentication, authController.changePassword);

module.exports = router;
