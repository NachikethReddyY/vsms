/**
 * @fileoverview Custom Application Errors
 * @module errors/AppError
 */

class AppError extends Error {
  constructor(
    statusCode = 500,
    code = "INTERNAL_ERROR",
    message = "An unexpected error occurred",
    details = null
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = "Request validation failed", details = null) {
    super(422, "VALIDATION_FAILED", message, details);
    this.name = "ValidationError";
  }
}

class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

class ConflictError extends AppError {
  constructor(message = "Request conflicts with current state") {
    super(409, "CONFLICT", message);
    this.name = "ConflictError";
  }
}

module.exports = AppError;
module.exports.AppError = AppError;
module.exports.ValidationError = ValidationError;
module.exports.NotFoundError = NotFoundError;
module.exports.ConflictError = ConflictError;