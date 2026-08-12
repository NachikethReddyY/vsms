const { PrismaClient } = require("@prisma/client");
const client = new PrismaClient();
console.log("qrPassEvent:", typeof client.qrPassEvent);
console.log("qRPassEvent:", typeof client.qRPassEvent);
client.$disconnect();
