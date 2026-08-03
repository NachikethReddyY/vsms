// routes/auditRoutes.js
const express = require("express");
const auditController = require("../controllers/auditController");
const authenticate = require("../middlewares/authenticate");
const { requireSystemRole } = require("../middlewares/authorize");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Protect all audit routes with authentication and restrict to admins/managers
// router.use(authenticate);
// router.use(requireSystemRole("ADMIN", "EVENT_MANAGER"));

// Analytics summary route must come BEFORE `/:id`
router.get("/analytics/summary", asyncHandler(auditController.getAuditAnalytics));

// Define endpoints matching the controller functions
router.get("/", asyncHandler(auditController.getAuditLogs));
router.get("/entity/:entityName/:entityId", asyncHandler(auditController.getAuditHistoryByEntity));
router.get("/:id", asyncHandler(auditController.getAuditLogById));

module.exports = router;