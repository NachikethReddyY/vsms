const AppError = require("../errors/AppError");

const validate = (schemas) => (req, _res, next) => {
  try {
    for (const [location, schema] of Object.entries(schemas)) {
      // Ensure the target location exists on the request object before parsing
      if (!req[location]) {
        req[location] = {};
      }

      const parsed = schema.parse(req[location]);
      
      if (location === "query") {
        Object.defineProperty(req, "query", { 
          value: parsed, 
          writable: false, 
          configurable: true,
          enumerable: true 
        });
      } else {
        req[location] = parsed;
      }
    }
    return next();
  } catch (error) {
    if (error.name === "ZodError") {
      const formattedErrors = error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      // Optional: Clean conditional console logging for development vs production
      if (process.env.NODE_ENV !== "production") {
        console.warn("Validation Warning:", JSON.stringify(formattedErrors, null, 2));
      }

      return next(
        new AppError(422, "VALIDATION_ERROR", "Request validation failed", formattedErrors)
      );
    }
    return next(error);
  }
};

module.exports = validate;