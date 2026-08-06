const express = require("express");
const accountController = require("../controllers/accountController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const validate = require("../middlewares/validate");
const { profileUpdateBody } = require("../schemas/accountSchemas");

const router = express.Router();
router.use(requireAuthentication);
router.get("/", accountController.me);
router.patch("/", validate({ body: profileUpdateBody }), accountController.updateMe);

module.exports = router;
