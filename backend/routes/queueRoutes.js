const express = require("express");
const router = express.Router();
const queueController = require("../controllers/queueController");
const authenticate = require("../middlewares/authenticate");
const checkIdempotency = require("../middlewares/idempotency"); // Import the new middleware

// ==========================================
// Queue Management Routes (Idempotent)
// ==========================================

// 1. Fetch live summary queue status for a specific event (Read-only, naturally idempotent)
router.get("/:eventId", authenticate, queueController.getQueueStatus);

// 2. Fetch specific live queue status for an individual participant (Read-only)
router.get("/participant/:participantId", authenticate, queueController.getParticipantQueueStatus);

// 3. Register/join a participant into a queue line (Protected by Idempotency Key)
router.post("/join", authenticate, checkIdempotency, queueController.joinQueue);

// 4. Advance a participant through queue stations (Protected by Idempotency Key)
router.patch("/:queueId/advance", authenticate, checkIdempotency, queueController.advanceQueue);

// 5. Remove or cancel a participant from the queue (Naturally idempotent)
router.delete("/:queueId", authenticate, queueController.leaveQueue);

module.exports = router;