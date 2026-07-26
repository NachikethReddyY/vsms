const express = require("express");

const router = express.Router();

const adminController = require("../controllers/adminController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");

router.use(requireAuthentication);
router.use(requireAnyRole("ADMINISTRATOR"));

router.get("/audit-logs", adminController.getAuditLogs);

module.exports = router;
