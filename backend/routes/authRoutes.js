const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController.js");
const asyncHandler = require("../utils/asyncHandler");
const validate = require("../middlewares/validate");
const csrf = require("../middlewares/csrf");
const { loginBody, signupBody } = require("../schemas/authSchemas");

router.post("/signup", validate({ body: signupBody }), asyncHandler(authController.signup));
router.post("/login", validate({ body: loginBody }), asyncHandler(authController.login));
router.post("/refresh", csrf, asyncHandler(authController.refresh));
router.post("/logout", csrf, asyncHandler(authController.logout));

module.exports = router;
