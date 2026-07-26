function notFoundHandler(req, res) {
    res.status(404).json({
        error: "Route not found",
        requestId: req.context?.requestId,
    });
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    const status = err.statusCode || 500;

    res.status(status).json({
        error: err.message || "Internal Server Error",
        details: err.details || null,
        requestId: req.context?.requestId,
    });
}

module.exports = {
    notFoundHandler,
    errorHandler,
};
