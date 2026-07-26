// prisma/prismaClient.js

const { PrismaClient } = require("@prisma/client");
const logger = require("../utils/logger/logger");

const prisma = new PrismaClient({
    log: [
        ...(process.env.NODE_ENV === "development" ? [{ emit: "event", level: "warn" }] : []),
        { emit: "event", level: "error" }
    ]
});

prisma.$on("warn", ({ message, target }) => logger.warn("database.warning", { message, target }));
prisma.$on("error", ({ message, target }) => logger.error("database.error", { message, target }));

// Gracefully disconnect Prisma when the application exits
process.on("SIGINT", async () => {
    await prisma.$disconnect();
    logger.info("database.disconnected");
    process.exit(0);
});

process.on("SIGTERM", async () => {
    await prisma.$disconnect();
    logger.info("database.disconnected");
    process.exit(0);
});

module.exports = prisma;
