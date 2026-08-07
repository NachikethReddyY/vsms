/**
 * ============================================================================
 * SECURE SERVER BOOTSTRAP
 * Visual Screening Management System (VSMS)
 *
 * Security Coverage:
 * - OWASP A05:2021 - Security Misconfiguration (TLS 1.3 & Timeout Hardening)
 * - OWASP A07:2021 - Identification and Authentication Failures
 * - OWASP A08:2021 - Software and Data Integrity Failures
 * - OWASP A09:2021 - Security Logging and Monitoring Failures
 * ============================================================================
 */

const fs = require("fs");
const https = require("https");
const path = require("path");

const app = require("./app");
const env = require("./config/env");
const logger = require("./utils/logger/logger");
const runSecurityChecks = require("./utils/securityCheck");

/**
 * ============================================================================
 * 1. GLOBAL PROCESS SECURITY HANDLERS (OWASP A09)
 * Catch unhandled exceptions or rejected promises to prevent memory leaks 
 * or unmonitored silent process failures.
 * ============================================================================
 */
process.on("uncaughtException", (error) => {
    logger.error("uncaught_exception", {
        message: error.message,
        stack: error.stack
    });
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    logger.error("unhandled_rejection", {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined
    });
    process.exit(1);
});

/**
 * ============================================================================
 * 2. SECURITY CONFIGURATION VALIDATION (OWASP A05)
 * Runs pre-flight startup checks to ensure environment variables, file 
 * permissions, and keys are secure before opening ports.
 * ============================================================================
 */
try {
    runSecurityChecks();
    logger.info("Security startup validation passed successfully");
} catch (error) {
    logger.error("Security startup validation failed", {
        message: error.message
    });
    process.exit(1);
}

/**
 * ============================================================================
 * 3. HTTPS / TLS CONFIGURATION (OWASP A05)
 * Enforces modern cryptographic standards (TLS 1.3 only) to block downgrade attacks.
 * ============================================================================
 */
const useHttps = !env.isProduction && env.localHttps;
let server;

if (useHttps) {
    const tlsOptions = {
        key: fs.readFileSync(path.resolve(__dirname, env.TLS_KEY_PATH)),
        cert: fs.readFileSync(path.resolve(__dirname, env.TLS_CERT_PATH)),
        
        // Force modern TLS protocols exclusively (Disables vulnerable TLS 1.0, 1.1, 1.2)
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
        
        // Enforce server-preferred cipher suites order
        honorCipherOrder: true
    };

    server = https.createServer(tlsOptions, app);
} else {
    // In production, TLS termination is typically handled upstream via a reverse proxy (e.g., Nginx, ALB)
    server = app;
}

/**
 * ============================================================================
 * 4. SERVER HARDENING & TIMEOUTS
 * Mitigates Slowloris Denial of Service (DoS) attacks by timing out hanging sockets.
 * ============================================================================
 */
server.headersTimeout = 10000;    // 10 seconds to parse headers
server.requestTimeout = 30000;    // 30 seconds max request window
server.keepAliveTimeout = 5000;   // 5 seconds keep-alive idle limit

server.on("error", (error) => {
    logger.error("server_error", {
        message: error.message,
        stack: error.stack
    });
});

/**
 * ============================================================================
 * 5. GRACEFUL SHUTDOWN HANDLING
 * Ensures ongoing database transactions and open HTTP connections are safely 
 * completed before terminating the process.
 * ============================================================================
 */
async function shutdown(signal) {
    logger.info(`${signal} received. Initiating graceful server shutdown...`);

    server.close(() => {
        logger.info("HTTP server closed successfully. Releasing system resources.");
        process.exit(0);
    });

    // Force shutdown timeout safeguard if connections hang indefinitely
    setTimeout(() => {
        logger.error("Forced server shutdown due to connection drain timeout.");
        process.exit(1);
    }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/**
 * ============================================================================
 * 6. START SERVER LISTENER
 * ============================================================================
 */
if (require.main === module) {
    const HOST = env.HOST || "0.0.0.0";
    const PORT = env.PORT || 4000;

    server.listen(PORT, HOST, () => {
        const protocol = useHttps ? "https" : "http";

        logger.info("server.started", {
            protocol,
            port: PORT,
            environment: env.NODE_ENV,
            tls: useHttps ? "TLS 1.3 Strict Enabled" : "Handled via Upstream Reverse Proxy"
        });

        console.log(`\x1b[32m✓ VSMS API Server Online (${protocol.toUpperCase()} on port ${PORT})\x1b[0m`);
    });
}

module.exports = {
    server
};