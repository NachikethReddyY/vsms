

const fs = require("fs");
const path = require("path");

const env = require("../config/env");
const { logger } = require("./logger/logger");

/**
 * Validates critical environment variables, TLS certificates, and production 
 * hardening settings prior to server initialization. Throws an error and logs 
 * failures if any required configuration check fails.
 */
const runSecurityChecks = () => {
  const isProduction = env.NODE_ENV === "production";
  const checks = [];

  const addCheck = (name, condition, error) => {
    checks.push({
      name,
      status: Boolean(condition),
      error,
    });
  };

  /**
   * 1. Database Configuration
   */
  addCheck(
    "DATABASE_URL exists",
    Boolean(env.DATABASE_URL),
    "Missing database connection string"
  );

  /**
   * 2. JWT Authentication Security
   */
  addCheck(
    "JWT_ACCESS_SECRET strength valid",
    Boolean(env.JWT_ACCESS_SECRET) && env.JWT_ACCESS_SECRET.length >= 32,
    "JWT access secret must be at least 32 characters"
  );

  /**
   * 3. Environment Configuration
   */
  addCheck(
    "NODE_ENV configured",
    ["development", "test", "production"].includes(env.NODE_ENV),
    "Invalid NODE_ENV value"
  );

  /**
   * 4. HTTPS / TLS Configuration (Development Check)
   */
  const tlsKeyPath = path.resolve(process.cwd(), env.TLS_KEY_PATH || "");
  const tlsCertPath = path.resolve(process.cwd(), env.TLS_CERT_PATH || "");

  addCheck(
    "TLS certificates exist",
    fs.existsSync(tlsKeyPath) && fs.existsSync(tlsCertPath),
    "Missing TLS certificate files"
  );

  /**
   * 5. Production Security Rules
   */
  if (isProduction) {
    addCheck(
      "Trust proxy configured",
      env.TRUST_PROXY !== undefined,
      "TRUST_PROXY must be configured in production"
    );

    addCheck(
      "Secure HTTPS cookies enabled",
      env.SECURE_COOKIES === true,
      "Secure cookies required in production"
    );
  }

  /**
   * ==========================================================================
   * VALIDATION RESULTS HANDLING
   * ==========================================================================
   */
  const failedChecks = checks.filter((check) => !check.status);

  if (failedChecks.length > 0) {
    if (!isProduction) {
      console.error("\n\x1b[31mSecurity validation failed:\x1b[0m");
      failedChecks.forEach((check) => {
        console.error(`  \x1b[31m✕ ${check.name}\x1b[0m: ${check.error}`);
      });
      console.log("");
    }

    logger.error("Security startup checks failed", {
      failedChecks: failedChecks.map((check) => check.name),
    });

    throw new Error("Critical security validation failed");
  }

  /**
   * Successful Startup Logging
   */
  if (isProduction) {
    logger.info("Security validation completed successfully");
  } else {
    console.log("\nSecurity checks:");
    checks.forEach((check) => {
      console.log(`\x1b[32m✓ ${check.name}\x1b[0m`);
    });
    console.log("\x1b[32mAll security startup checks passed successfully.\x1b[0m\n");
  }
};

module.exports = runSecurityChecks;