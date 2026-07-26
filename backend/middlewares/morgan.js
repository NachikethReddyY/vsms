const logger = require("../utils/logger/logger");

module.exports = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const statusCode = res.statusCode;
    const context = {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)),
      ...(req.user?.userId ? { userId: req.user.userId } : {}),
    };
    logger[statusCode >= 400 ? "warn" : "info"]("http.request.completed", context);
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      logger.warn("http.request.aborted", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
      });
    }
  });

  next();
};
