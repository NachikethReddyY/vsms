const prisma = require("../prisma/prismaClient");
const env = require("../config/env");
const logger = require("../utils/logging/logger/logger");
const { processNextLifecycleEmail, reconcileStaleLifecycleEmails } = require("../services/account/accountLifecycleNotificationService");

const once = process.argv.includes("--once");
const pollMs = env.LIFECYCLE_EMAIL_WORKER_POLL_MS;

async function main() {
  if (!env.lifecycleEmailEnabled) {
    logger.info("lifecycle-email-worker.disabled");
    return;
  }
  do {
    await reconcileStaleLifecycleEmails({ limit: 100 });
    let processed = 0;
    while (processed < 25 && await processNextLifecycleEmail()) processed += 1;
    if (!once && processed === 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (!once);
}

main().catch((error) => {
  logger.error("lifecycle-email-worker.failed", { code: error.code, message: error.message });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
