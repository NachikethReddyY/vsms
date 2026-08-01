const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

// Secure all audit endpoints to authenticated admins
// router.use(requireAuth, requireAdmin);

// GET /api/v1/audit-logs - Fetch paginated audit logs with optional filters
router.get('/', auditController.getAuditLogs);

// 1. Place specific static sub-routes FIRST
// GET /api/v1/audit-logs/entity/:entityName/:entityId - Fetch audit history for a specific record
router.get('/entity/:entityName/:entityId', auditController.getAuditHistoryByEntity);

// 2. Place generic dynamic parameter routes LAST
// GET /api/v1/audit-logs/:id - Fetch details of a specific audit entry
router.get('/:id', auditController.getAuditLogById);

module.exports = router;