/**
 * @fileoverview Custom Application Errors
 * @module errors/AppError
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR", details = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = "Request validation failed", details = null) {
    super(message, 422, "VALIDATION_FAILED", details);
  }
}

class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

class ConflictError extends AppError {
  constructor(message = "Request conflicts with current state") {
    super(message, 409, "CONFLICT");
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
};