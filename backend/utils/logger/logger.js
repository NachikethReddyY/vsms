const pino = require("pino");
const env = require("../../config/env");

const logger = pino({
  level: env.LOG_LEVEL || (env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: [
      "authorization",
      "cookie",
      "set-cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.raw.headers.authorization",
      "req.raw.headers.cookie",
      "body",
      "query",
      "params",
      "req.body",
      "req.query",
      "req.params",
      "token",
      "accessToken",
      "idToken",
      "refreshToken",
      "qrToken",
      "csrfToken",
      "password",
      "mfaCode",
      "email",
      "username",
      "fullName",
      "participantId",
      "participantReference",
      "registrationId",
      "dateOfBirth",
      "contactNumber",
      "clinical",
      "screening",
      "results",
      "errorMessage",
      "reason",
      "message",
    ],
    censor: "[REDACTED]",
  },
  hooks: {
    // Keep the existing logger(message, context) call shape while using Pino's
    // object-first API for every application and HTTP log.
    logMethod(inputArgs, method) {
      if (
        typeof inputArgs[0] === "string" &&
        inputArgs[1] &&
        typeof inputArgs[1] === "object" &&
        !Array.isArray(inputArgs[1])
      ) {
        return method.apply(this, [inputArgs[1], inputArgs[0], ...inputArgs.slice(2)]);
      }
      return method.apply(this, inputArgs);
    },
  },
});

module.exports = logger;
