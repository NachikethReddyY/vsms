const express = require("express");
const router = express.Router();
const queueController = require("../controllers/queueController");
const authenticate = require("../middlewares/authenticate");
const authorize = require("../middlewares/authorize"); // If you have role-based checks

// ==========================================
// Queue Management Routes
// ==========================================

// 1. Fetch live summary queue status for a specific event
router.get("/:eventId", authenticate, queueController.getQueueStatus);

// 2. Fetch specific live queue status for an individual participant (Participant view)
router.get("/participant/:participantId", authenticate, queueController.getParticipantQueueStatus);

// 3. Register/join a participant into a queue line
router.post("/join", authenticate, queueController.joinQueue);

// 4. Advance a participant through queue stations (Admin / Station Staff)
router.patch("/:queueId/advance", authenticate, queueController.advanceQueue);

// 5. Remove or cancel a participant from the queue (Optional expansion)
router.delete("/:queueId", authenticate, queueController.leaveQueue);

module.exports = router;