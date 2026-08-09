const prisma = require("../prisma/prismaClient");
const logger = require("../utils/logger/logger");
const { expireReportArtifacts, processNextReportJob } = require("../services/reporting/reportExportService");
const { processArtifactCleanupTasks } = require("../services/platform/artifactCleanupService");

const once = process.argv.includes("--once");
const pollMs = Math.min(Math.max(Number(process.env.REPORT_WORKER_POLL_MS || 5000), 250), 60000);

async function cycle() {
  await expireReportArtifacts({ limit: 100 });
  await processArtifactCleanupTasks({ limit: 100 });
  let processed = 0;
  while (processed < 25 && await processNextReportJob()) processed += 1;
  return processed;
}

async function main() {
  do {
    const processed = await cycle();
    if (!once && processed === 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (!once);
}

main().catch((error) => {
  logger.error("report-worker.failed", { code: error.code, message: error.message });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
