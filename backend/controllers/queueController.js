/**
 * @fileoverview Queue & Station Transfer Controller
 * @module controllers/queueController
 * @description
 * Handles HTTP requests for virtual queue operations, queue status tracking,
 * station transitions, priority adjustments, handoffs, and workload monitoring.
 */

const queueService = require("../services/screening/queueService");
const { ValidationError } = require("../middlewares/errorHandler");

/* ==========================================================================
   Helper Functions & Middleware Wrappers
   ========================================================================== */

/**
 * Higher-order function to catch asynchronous errors and forward them
 * directly to Express centralized error-handling middleware.
 *
 * @param {Function} fn Controller function
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Safely retrieves the authenticated user from the request context.
 *
 * @param {Object} req Express request
 * @returns {Object} Authenticated user
 * @throws {ValidationError} When authenticated user context is missing
 */
const getAuthenticatedUser = (req) => {
    if (!req.user) {
        throw new ValidationError("Authenticated user context is required.");
    }
    return req.user;
};

/**
 * Retrieves audit/security context from the request.
 *
 * @param {Object} req Express request
 * @returns {Object|undefined} Request context
 */
const getRequestContext = (req) => req.context;

/**
 * Validates and extracts a required route parameter.
 *
 * @param {Object} req Express request
 * @param {string} parameterName Parameter key name
 * @returns {string} Trimmed parameter value
 * @throws {ValidationError} When parameter is missing or empty
 */
const requireRouteParam = (req, parameterName) => {
    const value = req.params?.[parameterName];

    if (!value || typeof value !== "string" || value.trim() === "") {
        throw new ValidationError(
            `Route parameter '${parameterName}' is required.`
        );
    }

    return value.trim();
};

/**
 * Formats standard API JSON response.
 *
 * @param {Object} res Express response
 * @param {number} statusCode HTTP status code
 * @param {*} data Response payload
 * @returns {Object} Express response JSON
 */
const sendSuccess = (res, statusCode, data) => {
    return res.status(statusCode).json({
        status: "success",
        data,
    });
};

/* ==========================================================================
   Controller Handlers
   ========================================================================== */

/**
 * Retrieves the current queue status for an event.
 * @route GET /api/v1/events/:eventId/queue/status
 */
exports.getEventQueueStatus = asyncHandler(async (req, res) => {
    const eventId = requireRouteParam(req, "eventId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.getEventQueueStatus(eventId, user);

    return sendSuccess(res, 200, result);
});

/**
 * Lists stations associated with participant registrations for an event.
 * @route GET /api/v1/events/:eventId/stations
 */
exports.listRegistrationStations = asyncHandler(async (req, res) => {
    const eventId = requireRouteParam(req, "eventId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.listRegistrationStations(eventId, user);

    return sendSuccess(res, 200, result);
});

/**
 * Retrieves the queue status of a specific participant registration.
 * @route GET /api/v1/events/:eventId/registrations/:registrationId/queue
 */
exports.getParticipantQueueStatus = asyncHandler(async (req, res) => {
    const eventId = req.params.eventId?.trim() || null;
    const registrationId = requireRouteParam(req, "registrationId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.getParticipantQueueStatus(
        eventId,
        registrationId,
        user
    );

    return sendSuccess(res, 200, result);
});

/**
 * Calls a queue entry for service.
 * @route POST /api/v1/events/:eventId/entries/:queueId/call
 */
exports.callQueueEntry = asyncHandler(async (req, res) => {
    const queueId = requireRouteParam(req, "queueId");
    const eventId = requireRouteParam(req, "eventId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.callQueueEntry({
        queueId,
        eventId,
        user,
        context: getRequestContext(req),
    });

    return sendSuccess(res, 200, result);
});

/**
 * Starts processing a queue entry.
 * @route POST /api/v1/events/:eventId/entries/:queueId/start
 */
exports.startQueueEntry = asyncHandler(async (req, res) => {
    const queueId = requireRouteParam(req, "queueId");
    const eventId = requireRouteParam(req, "eventId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.startQueueEntry({
        queueId,
        eventId,
        user,
        context: getRequestContext(req),
    });

    return sendSuccess(res, 200, result);
});

/**
 * Skips a queue entry.
 * @route POST /api/v1/events/:eventId/entries/:queueId/skip
 */
exports.skipQueueEntry = asyncHandler(async (req, res) => {
    const queueId = requireRouteParam(req, "queueId");
    const eventId = requireRouteParam(req, "eventId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.skipQueueEntry({
        queueId,
        eventId,
        user,
        context: getRequestContext(req),
    });

    return sendSuccess(res, 200, result);
});

/**
 * Removes a participant from the queue.
 * @route DELETE /api/v1/events/:eventId/entries/:queueId
 */
exports.leaveQueue = asyncHandler(async (req, res) => {
    const queueId = requireRouteParam(req, "queueId");
    const eventId = requireRouteParam(req, "eventId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.leaveQueue({
        queueId,
        eventId,
        user,
        context: getRequestContext(req),
    });

    return sendSuccess(res, 200, result);
});

/**
 * Updates the priority status of a queue entry.
 * @route PATCH /api/v1/events/:eventId/entries/:queueId/priority
 */
exports.updatePriority = asyncHandler(async (req, res) => {
    const queueId = requireRouteParam(req, "queueId");
    const eventId = req.params?.eventId?.trim() || null;
    const user = getAuthenticatedUser(req);
    const { isPriority, notes } = req.body || {};

    if (typeof isPriority !== "boolean") {
        throw new ValidationError(
            "Field 'isPriority' must be specified as a boolean value."
        );
    }

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
        throw new ValidationError(
            "Field 'notes' must be a string when provided."
        );
    }

    const result = await queueService.updatePriority(
        {
            queueId,
            isPriority,
            notes: notes?.trim() || null,
            eventId,
        },
        user,
        getRequestContext(req)
    );

    return sendSuccess(res, 200, result);
});

/**
 * Retrieves live workload statistics for screening stations.
 * @route GET /api/v1/events/:eventId/workload
 */
exports.getStationWorkload = asyncHandler(async (req, res) => {
    const eventId = requireRouteParam(req, "eventId");
    const user = getAuthenticatedUser(req);

    const result = await queueService.getStationWorkload(eventId, user);

    return sendSuccess(res, 200, result);
});
