// utils/logger.js

const winston = require("winston");

// Define a unified format that includes timestamp
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp }) => {
    // Falls back gracefully if timestamp isn't provided so it never prints 'undefined'
    const time = timestamp || new Date().toISOString();
    return `[${time}] ${level}: ${message}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  transports: [
    // Your File transports here...
    
    // Fixed Console Transport:
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

module.exports = logger;