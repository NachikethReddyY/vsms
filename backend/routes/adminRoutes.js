const express = require("express");

const router = express.Router();

const adminController = require("../controllers/adminController");
const accountController = require("../controllers/accountController");
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
  accountProviderDrainBody,
  accountProviderOperationParams,
  accountProviderOperationActionBody,
} = require("../schemas/adminSchemas");
const {
  accountParams,
  accountListQuery,
  approvalBody,
  rejectionBody,
  suspensionBody,
  reactivationBody,
  deprovisionBody,
  lifecycleEmailParams,
  lifecycleEmailMaintenanceBody,
} = require("../schemas/accountSchemas");

router.use(requireAuthentication);
router.use(requireAnyRole("ADMINISTRATOR"));

router.get("/accounts", validate({ query: accountListQuery }), accountController.list);
router.get("/accounts/:accountId", validate({ params: accountParams }), accountController.detail);
router.post("/accounts/:accountId/approve", validate({ params: accountParams, body: approvalBody }), accountController.approve);
router.post("/accounts/:accountId/reject", validate({ params: accountParams, body: rejectionBody }), accountController.reject);
router.post("/accounts/:accountId/suspend", validate({ params: accountParams, body: suspensionBody }), accountController.suspend);
router.post("/accounts/:accountId/reactivate", validate({ params: accountParams, body: reactivationBody }), accountController.reactivate);
router.post("/accounts/:accountId/revoke-sessions", validate({ params: accountParams }), accountController.revokeSessions);
router.post("/accounts/:accountId/deprovision", validate({ params: accountParams, body: deprovisionBody }), accountController.deprovision);
router.post("/accounts/:accountId/resend-lifecycle", validate({ params: accountParams }), accountController.resendLifecycle);
router.post("/maintenance/lifecycle-emails/:deliveryId", validate({ params: lifecycleEmailParams, body: lifecycleEmailMaintenanceBody }), accountController.maintainLifecycleEmail);
router.post(
  "/maintenance/account-provider-operations/drain",
  validate({ body: accountProviderDrainBody }),
  adminController.drainAccountProviderOperations,
);
router.post(
  "/maintenance/account-provider-operations/:operationId/requeue",
  validate({ params: accountProviderOperationParams, body: accountProviderOperationActionBody }),
  adminController.requeueAccountProviderOperation,
);
router.post(
  "/maintenance/account-provider-operations/:operationId/resolve",
  validate({ params: accountProviderOperationParams, body: accountProviderOperationActionBody }),
  adminController.resolveAccountProviderOperation,
);

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
