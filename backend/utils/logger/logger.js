const fs = require("fs");
const path = require("path");
const env = require("../../config/env");

const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };
const minimumLevel = env.LOG_LEVEL || (env.NODE_ENV === "test" ? "silent" : "info");
const logDirectory = path.resolve(__dirname, "../../logs");

const append = (file, line) => {
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.appendFileSync(path.join(logDirectory, file), `${line}\n`);
};

const write = (level, message, context = {}) => {
  if (levels[level] < levels[minimumLevel]) return;
  const line = JSON.stringify({
    ...context,
    timestamp: new Date().toISOString(),
    level,
    message,
  });
  append("combined.log", line);
  if (level === "error") append("error.log", line);
};

module.exports = {
  debug: (message, context) => write("debug", message, context),
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
};
