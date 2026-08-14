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
const http = require("http");
const path = require("path");

const app = require("./app");
const env = require("./config/env");
const db = require("./config/db");
const prisma = require("./prisma/prismaClient");
const { closeRateLimiterClient } = require("./middlewares/rateLimiter");
const logger = require("./utils/logging/logger/logger");
const runSecurityChecks = require("./utils/security/securityCheck");

// ============================================================================
// 1. GLOBAL PROCESS SECURITY HANDLERS
// ============================================================================

process.on("uncaughtException", (error) => {
    logger.error("uncaught_exception", {
        message: error.message,
        stack: error.stack,
    });
    void shutdown("uncaughtException", 1).finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
    logger.error("unhandled_rejection", {
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });

    void shutdown("unhandledRejection", 1).finally(() => process.exit(1));
});

// ============================================================================
// 2. SECURITY CONFIGURATION VALIDATION
// ============================================================================

try {
    runSecurityChecks();

    logger.info("Security startup validation passed successfully");
} catch (error) {
    logger.error("Security startup validation failed", {
        message: error.message,
        stack: error.stack,
    });

    process.exit(1);
}

// ============================================================================
// 3. CREATE HTTP / HTTPS SERVER
// ============================================================================

const useHttps = !env.isProduction && env.localHttps;

let server;

if (useHttps) {
    const tlsOptions = {
        key: fs.readFileSync(
            path.resolve(__dirname, env.TLS_KEY_PATH)
        ),

        cert: fs.readFileSync(
            path.resolve(__dirname, env.TLS_CERT_PATH)
        ),

        // TLS 1.3 only
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",

        honorCipherOrder: true,
    };

    server = https.createServer(tlsOptions, app);
} else {
    server = http.createServer(app);
}

// ============================================================================
// 4. SERVER TIMEOUT HARDENING
// ============================================================================

server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

// ============================================================================
// 5. SERVER ERROR HANDLING
// ============================================================================

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        logger.error("server_port_in_use", {
            host: env.HOST,
            port: env.PORT,
            message: `Port ${env.PORT} is already being used.`,
        });

        process.exit(1);
    }

    logger.error("server_error", {
        code: error.code,
        message: error.message,
        stack: error.stack,
    });

    process.exit(1);
});

// ============================================================================
// 6. GRACEFUL SHUTDOWN
// ============================================================================

const SHUTDOWN_GRACE_MS = 25_000;
let shutdownPromise = null;

function closeHttpServer() {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
            else resolve();
        });
        server.closeIdleConnections?.();
    });
}

async function shutdown(signal, exitCode = 0) {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
        logger.info(`${signal} received. Initiating graceful server shutdown...`);
        const forceTimer = setTimeout(() => {
            logger.error("Forced server shutdown due to connection drain timeout.");
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);

        try {
            await closeHttpServer();
            const resources = await Promise.allSettled([
                prisma.$disconnect(),
                db.end(),
                closeRateLimiterClient(),
            ]);
            const failures = resources.filter(({ status }) => status === "rejected");
            if (failures.length) {
                throw new AggregateError(failures.map(({ reason }) => reason), "One or more resources could not close");
            }
            logger.info("HTTP server drained and database and Redis connections closed.");
            process.exitCode = exitCode;
        } catch (error) {
            logger.error("server_shutdown_failed", {
                message: error.message,
                stack: error.stack,
            });
            process.exitCode = 1;
        } finally {
            clearTimeout(forceTimer);
        }
    })();

    return shutdownPromise;
}

process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
    void shutdown("SIGINT");
});

// ============================================================================
// 7. START SERVER
// ============================================================================

if (require.main === module) {
    const HOST = env.HOST || "0.0.0.0";
    const PORT = env.PORT || 5050;

    server.listen(PORT, HOST, () => {
        const protocol = useHttps ? "https" : "http";

        logger.info("VSMS backend server started", {
            protocol,
            host: HOST,
            port: PORT,
            environment: env.NODE_ENV || "development",
        });
    });
}

module.exports = {
    server,
    shutdown,
};
