// prisma/prismaClient.js

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
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
