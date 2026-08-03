const AppError = require("../errors/AppError");

const validate = (schemas) => (req, _res, next) => {
  try {
    for (const [location, schema] of Object.entries(schemas)) {
      const parsed = schema.parse(req[location]);
      if (location === "query") {
        Object.defineProperty(req, "query", { value: parsed, writable: false, configurable: true });
      } else {
        req[location] = parsed;
      }
    }
    next();
  } catch (error) {
    if (error.name === "ZodError") {
      return next(new AppError(422, "VALIDATION_ERROR", "Request validation failed", error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }))));
    }
    return next(error);
  }
};

module.exports = validate;
