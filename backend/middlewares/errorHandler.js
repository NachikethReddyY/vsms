/**
 * @fileoverview Global Express Error Handler
 * @module middlewares/errorHandler
 * @description Centralized error processing, logging, and API error responses.
 */

const { AppError } = require("../errors/AppError"); // Make sure path matches your structure
const logger = require("../utils/logger/logger");

const fallbackMessage = (status) => ({
    400: "Request could not be processed",
    401: "Authentication required",
    403: "Access denied",
    404: "Resource not found",
    409: "Request conflicts with current state",
    422: "Request validation failed",
    429: "Too many requests",
}[status] || (
    status >= 500
        ? "An unexpected error occurred"
        : "Request failed"
));

const notFound = (req, _res, next) => {
    next(
        new AppError(
            404,
            "NOT_FOUND",
            `Route ${req.method} ${req.path} was not found`
        )
    );
};

const errorHandler = (error, req, res, _next) => {
    const known = error instanceof AppError;
    const hintedStatus = Number(error?.statusCode);

    const status = known
        ? error.status
        : (Number.isInteger(hintedStatus) && hintedStatus >= 400 && hintedStatus <= 599)
            ? hintedStatus
            : 500;

    const code = known
        ? error.code
        : status === 500
            ? "INTERNAL_ERROR"
            : "REQUEST_FAILED";

    const publicMessage = known
        ? error.message
        : fallbackMessage(status);

    const requestId = req.requestId || req.context?.requestId;
    res.err = error;
    (req.log || logger)[status >= 500 ? "error" : "warn"]({
        event: "application.error",
        ...(!req.log && requestId ? { requestId } : {}),
        status,
        code,
    }, "application.error");

    res.status(status).json({
        type: `https://vsms.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
        title: publicMessage,
        error: publicMessage,
        status,
        code,
        requestId: req.requestId,
        ...(known && error.details ? { errors: error.details } : {})
    });
};

module.exports = {
    notFound,
    errorHandler
};
