const fs = require("fs");
const https = require("https");
const path = require("path");

const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger/logger");
const runSecurityChecks = require("./utils/securityCheck"); // OWASP A05 Startup Validation

/**
 * ============================================================================
 * 1. SECURITY & CONFIGURATION STARTUP CHECKS (OWASP A05)
 * ============================================================================
 */
try {
  runSecurityChecks();
} catch (err) {
  logger.error("Security startup checks failed", { error: err.message });
  process.exit(1);
}

/**
 * ============================================================================
 * 2. PROTOCOL & SERVER INSTANTIATION
 * ============================================================================
 */
const useHttps = !env.isProduction && env.localHttps;

// Instantiate HTTPS server for local development if configured, otherwise standard HTTP/Express app
const server = useHttps
  ? https.createServer(
      {
        key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
        cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
      },
      app
    )
  : app;

// Global Server Error Event Listener
server.on("error", (error) => {
  logger.error("server.failed", { message: error.message, stack: error.stack });
  process.exitCode = 1;
});

/**
 * ============================================================================
 * 3. SERVER LISTENER
 * ============================================================================
 */
if (require.main === module) {
  const HOST = env.HOST || "0.0.0.0";
  const PORT = env.PORT || 4000;

  server.listen(PORT, HOST, () => {
    const protocol = useHttps ? "https" : "http";
    logger.info(`Server started successfully`, {
      url: `${protocol}://${HOST}:${PORT}`,
      environment: env.NODE_ENV,
      secureProtocol: useHttps ? "TLS/HTTPS" : "HTTP",
    });
    console.log(`\x1b[32m✓ Server started and running on ${protocol}://${HOST}:${PORT} [${env.NODE_ENV}]\x1b[0m`);
  });
}

module.exports = { server };
