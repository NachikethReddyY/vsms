const express = require("express");

const router = express.Router();

const eventController = require("../controllers/eventController");

// ==========================================
// Create Event
// POST /events/create
// ==========================================
router.post(
    "/create",
    eventController.createEvent
);

// ==========================================
// Get All Events
// GET /events
// ==========================================
router.get(
    "/",
    eventController.getAllEvents
);

// ==========================================
// Get Event By ID
// GET /events/:id
// ==========================================
router.get(
    "/:id",
    eventController.getEventById
);

// ==========================================
// Update Event
// PUT /events/:id
// ==========================================
router.put(
    "/:id",
    eventController.updateEvent
);

// ==========================================
// Delete Event
// DELETE /events/:id
// ==========================================
router.delete(
    "/:id",
    eventController.deleteEvent
);

module.exports = router;