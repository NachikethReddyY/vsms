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

    const status = err.statusCode || (err.code === "P2002" ? 409 : 500);
    const requestId = req.context?.requestId;

    if (status >= 500) {
        console.error(
            `Request ${requestId || "unknown"} failed (${err.name || "Error"}${err.code ? `/${err.code}` : ""})`
        );
    }

    res.status(status).json({
        error: status >= 500 ? "Internal server error" : (err.message || "Request failed"),
        details: status >= 500 ? null : (err.details || null),
        requestId,
    });
}

module.exports = {
    notFoundHandler,
    errorHandler,
};
