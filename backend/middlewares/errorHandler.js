const AppError = require("../errors/AppError");

const notFound = (req, _res, next) => next(new AppError(404, "NOT_FOUND", `Route ${req.method} ${req.path} was not found`));

const errorHandler = (error, req, res, _next) => {
  const known = error instanceof AppError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "INTERNAL_ERROR";

  if (!known) {
    console.error(JSON.stringify({ level: "error", requestId: req.requestId, code, message: error.message }));
  }

  res.status(status).json({
    type: `https://vsms.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: known ? error.message : "An unexpected error occurred",
    status,
    code,
    requestId: req.requestId,
    ...(known && error.details ? { errors: error.details } : {}),
  });
};

module.exports = { notFound, errorHandler };
