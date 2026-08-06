const express = require("express");

const router = express.Router();

const adminController = require("../controllers/adminController");
const requireAuthentication = require("../middlewares/requireAuthentication");
const requireAnyRole = require("../middlewares/requireAnyRole");
const requirePermission = require("../middlewares/requirePermission");
const validate = require("../middlewares/validate");
const {
  referralDeliveryMaintenanceBody,
  auditLogListQuery,
  artifactCleanupListQuery,
  artifactCleanupParams,
  artifactCleanupActionBody,
} = require("../schemas/adminSchemas");

router.use(requireAuthentication);
router.use(requireAnyRole("ADMINISTRATOR"));

router.get("/audit-logs", requirePermission("audit:read"), validate({ query: auditLogListQuery }), adminController.getAuditLogs);
router.post(
  "/maintenance/referral-deliveries",
  validate({ body: referralDeliveryMaintenanceBody }),
  adminController.runReferralDeliveryMaintenance,
);
router.get(
  "/maintenance/artifact-cleanup",
  validate({ query: artifactCleanupListQuery }),
  adminController.listArtifactCleanupTasks,
);
router.post(
  "/maintenance/artifact-cleanup/:taskId",
  validate({ params: artifactCleanupParams, body: artifactCleanupActionBody }),
  adminController.maintainArtifactCleanupTask,
);

module.exports = router;
