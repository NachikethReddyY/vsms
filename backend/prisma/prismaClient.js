// prisma/prismaClient.js

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
    // Query logging can include participant data and is therefore opt-in only.
    log: process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
});

module.exports = prisma;
