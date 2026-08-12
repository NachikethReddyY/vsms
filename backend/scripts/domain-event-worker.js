const prisma = require("../prisma/prismaClient");
const logger = require("../utils/logging/logger/logger");
const domainEventBus = require("../services/domain/domainEventBus");
const { registerDomainEventHandlers } = require("../services/domain/domainEventHandlers");

const once = process.argv.includes("--once");
const pollMs = Math.min(Math.max(Number(process.env.DOMAIN_EVENT_WORKER_POLL_MS || 5000), 250), 60000);

registerDomainEventHandlers(domainEventBus);

async function cycle() {
  const summary = await domainEventBus.processNextDomainEvents({ limit: 25 });
  if (summary.retried > 0 || summary.deadLettered > 0) {
    logger.warn("domain-event-worker.summary", summary);
  }
  return summary.attempted;
}

async function main() {
  do {
    const processed = await cycle();
    if (!once && processed === 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (!once);
}

main().catch((error) => {
  logger.error("domain-event-worker.failed", { code: error.code, message: error.message });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
