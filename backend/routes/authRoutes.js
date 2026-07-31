const express = require("express");
const authController = require("../controllers/authController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const validate = require("../middlewares/validate");
const csrf = require("../middlewares/csrf");
const { rateLimit } = require("../middlewares/security");
const { loginBody } = require("../schemas/authSchemas");

const router = express.Router();

router.post("/login", rateLimit({ windowMs: 15 * 60_000, max: 10 }), validate({ body: loginBody }), authController.login);
router.post("/refresh", rateLimit({ windowMs: 60_000, max: 30 }), csrf, authController.refresh);
router.get("/me", requireAuthentication, authController.me);
router.post("/logout", csrf, authController.logout);

module.exports = router;
