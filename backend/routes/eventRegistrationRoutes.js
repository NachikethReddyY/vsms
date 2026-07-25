const express = require("express");
const router = express.Router();

const eventController = require("../controllers/eventController");
const { authenticate, requireSystemRole } = require("../middlewares/authMiddleware");

// Apply authentication middleware to all event routes
router.use(authenticate);

// ==========================================
// Event CRUD & Core Actions
// ==========================================
router.get("/", eventController.list);
router.post("/", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.create);
router.get("/staff-directory", eventController.staffDirectory);
router.get("/:eventId", eventController.get);
router.put("/:eventId", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.update);

// ==========================================
// Lifecycle / Transitions
// ==========================================
router.post("/:eventId/publish", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.publish);
router.post("/:eventId/start", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.start);
router.post("/:eventId/complete", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.complete);
router.post("/:eventId/cancel", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.cancel);

// ==========================================
// Staffing & Assignments
// ==========================================
router.post("/:eventId/shifts/:shiftId/assignments", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.addAssignment);
router.delete("/:eventId/shifts/:shiftId/assignments/:assignmentId", requireSystemRole("ADMIN", "EVENT_MANAGER"), eventController.removeAssignment);

// ==========================================
// Audit Logs
// ==========================================
router.get("/:eventId/audit", requireSystemRole("ADMIN"), eventController.audit);

module.exports = router;