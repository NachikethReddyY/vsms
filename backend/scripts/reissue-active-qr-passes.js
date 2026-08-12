const prisma = require("../prisma/prismaClient");
const qrService = require("../services/participant/qrService");

async function main() {
  const now = new Date();
  const registrations = await prisma.eventRegistration.findMany({
    where: {
      registrationStatus: { in: ["SIGNED_UP", "CHECKED_IN"] },
      event: { status: { in: ["PUBLISHED", "IN_PROGRESS"] } },
      qrCodePasses: {
        none: {
          isActive: true,
          revokedAt: null,
          expiresAt: { gt: now },
          tokenHash: { not: null },
          tokenCiphertext: { not: null },
          tokenEncryptionVersion: 2,
        },
      },
    },
    select: { registrationId: true },
    orderBy: { registrationId: "asc" },
  });

  for (const { registrationId } of registrations) {
    await qrService.generateQR(registrationId);
  }
  console.log(`Reissued ${registrations.length} active secure QR pass(es).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
