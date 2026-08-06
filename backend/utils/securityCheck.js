const env = require("../config/env");
const { logger } = require("./logger/logger"); // Or your custom logger

const runSecurityChecks = () => {
  console.log("Checking security and configuration settings...");

  const checks = [];

  // 1. Check Database Configuration
  if (env.DATABASE_URL) {
    checks.push({ name: "DATABASE_URL exists", status: true });
  } else {
    checks.push({ name: "DATABASE_URL exists", status: false, error: "Missing database connection string" });
  }

  // 2. Check Production Protocol Enforcement
  if (env.NODE_ENV === "production") {
    if (env.TRUST_PROXY !== undefined) {
      checks.push({ name: "Trust Proxy configured for production", status: true });
    } else {
      checks.push({ name: "Trust Proxy configured for production", status: false, error: "Trust proxy should be explicitly set behind load balancers" });
    }
  } else {
    checks.push({ name: "NODE_ENV development/test mode", status: true });
  }

  // 4. Print Results & Handle Failures
  let hasErrors = false;
  checks.forEach((check) => {
    if (check.status) {
      console.log(`\x1b[32m✓ ${check.name}\x1b[0m`);
    } else {
      console.error(`\x1b[31m✕ ${check.name}\x1b[0m — Error: ${check.error}`);
      hasErrors = true;
    }
  });

  if (hasErrors) {
    console.error("\x1b[31mCritical security validation failed. Aborting startup.\x1b[0m");
    process.exit(1);
  }

  console.log("\x1b[32mAll security startup checks passed successfully.\x1b[0m\n");
};

module.exports = runSecurityChecks;