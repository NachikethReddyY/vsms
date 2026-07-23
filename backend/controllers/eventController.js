const eventModel = require("../models/eventModel");

// ==========================================
// Create Event
// ==========================================
exports.createEvent = async (req, res) => {

    try {

        const event = await eventModel.createEvent(req.body);

        return res.status(201).json({
            success: true,
            message: "Event created successfully.",
            data: event
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};

// ==========================================
// Get All Events
// ==========================================
exports.getAllEvents = async (req, res) => {

    try {

        const events = await eventModel.getAllEvents();

        return res.status(200).json({
            success: true,
            data: events
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};

// ==========================================
// Get Event By ID
// ==========================================
exports.getEventById = async (req, res) => {

    try {

        const event = await eventModel.getEventById(req.params.id);

        return res.status(200).json({
            success: true,
            data: event
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};

// ==========================================
// Update Event
// ==========================================
exports.updateEvent = async (req, res) => {

    try {

        const event = await eventModel.updateEvent(
            req.params.id,
            req.body
        );

        return res.status(200).json({
            success: true,
            message: "Event updated successfully.",
            data: event
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};

// ==========================================
// Delete Event
// ==========================================
exports.deleteEvent = async (req, res) => {

    try {

        await eventModel.deleteEvent(req.params.id);

        return res.status(200).json({
            success: true,
            message: "Event deleted successfully."
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};