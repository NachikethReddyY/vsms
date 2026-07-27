const express = require("express");
const router = express.Router();
const queueController = require("../controllers/queueController");
const authenticate = require("../middlewares/authenticate");

// Fetch live queue status for an event
router.get("/:eventId", authenticate, queueController.getQueueStatus);

// Advance a participant through the queue stations
router.patch("/:queueId/advance", authenticate, queueController.advanceQueue);

module.exports = router;