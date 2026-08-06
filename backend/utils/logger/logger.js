const fs = require("fs");
const path = require("path");
const env = require("../../config/env");

// Define log priority levels
const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };
const minimumLevel = env.LOG_LEVEL || (env.NODE_ENV === "test" ? "silent" : "info");
const logDirectory = path.resolve(__dirname, "../../logs");

// Ensure log directory exists once at startup (sync is safe during boot/initialization)
try {
  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
  }
} catch (err) {
  console.error("Failed to create log directory:", err.message);
}

/**
 * Asynchronously append log lines to prevent blocking the Node.js event loop
 * @param {string} file - Target log filename
 * @param {string} line - Formatted JSON log string
 */
const appendAsync = (file, line) => {
  const filePath = path.join(logDirectory, file);
  fs.appendFile(filePath, `${line}\n`, (err) => {
    if (err) {
      console.error(`Failed to write to log file (${file}):`, err.message);
    }
  });
};

/**
 * Core log writing function with level filtering and fallback console output
 * @param {string} level - Log level (debug, info, warn, error)
 * @param {string} message - Log message
 * @param {Object} context - Additional metadata/context
 */
const write = (level, message, context = {}) => {
  if (levels[level] < levels[minimumLevel]) return;

  // Standardize error objects if passed inside context
  let serializedContext = { ...context };
  if (serializedContext.err instanceof Error) {
    serializedContext.err = {
      message: serializedContext.err.message,
      stack: serializedContext.err.stack,
      name: serializedContext.err.name,
    };
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...serializedContext,
  };

  const line = JSON.stringify(logEntry);

  // Write asynchronously to file targets
  appendAsync("combined.log", line);
  if (level === "error") {
    appendAsync("error.log", line);
  }

  // Optional: In development mode, pretty-print to console for developer visibility
  if (env.NODE_ENV !== "production" && env.NODE_ENV !== "test") {
    const colorCode = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : "\x1b[32m";
    console.log(`${colorCode}[${level.toUpperCase()}] ${logEntry.timestamp}\x1b[0m:`, message, context);
  }
};

module.exports = {
  debug: (message, context) => write("debug", message, context),
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
};