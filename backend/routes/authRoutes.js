const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");
const requireAuthentication = require("../middlewares/requireAuthentication");

router.get("/config-status", authController.configStatus);
router.post("/signup", authController.signup);
router.post("/confirm-signup", authController.confirmSignup);
router.post("/resend-code", authController.resendCode);
router.post("/login", authController.login);
router.post("/respond-to-challenge", authController.respondToChallenge);
router.post("/refresh", authController.refresh);
router.get("/me", requireAuthentication, authController.me);
router.post("/logout", requireAuthentication, authController.logout);
router.post("/global-logout", requireAuthentication, authController.logout);
router.post("/forgot-password", authController.forgotPassword);
router.post("/confirm-forgot-password", authController.confirmForgotPassword);
router.post("/change-password", requireAuthentication, authController.changePassword);

module.exports = router;
