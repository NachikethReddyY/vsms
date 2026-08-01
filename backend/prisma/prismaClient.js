// prisma/prismaClient.js

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
    // Query logging can include participant data and is therefore opt-in only.
    log: process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
});

// Gracefully disconnect Prisma when the application exits
process.on("SIGINT", async () => {
    await prisma.$disconnect();
    console.log("Prisma Client disconnected.");
    process.exit(0);
});

process.on("SIGTERM", async () => {
    await prisma.$disconnect();
    console.log("Prisma Client disconnected.");
    process.exit(0);
});

module.exports = prisma;
