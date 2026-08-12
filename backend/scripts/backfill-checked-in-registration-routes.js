const prisma = require("../prisma/prismaClient");
const { assignCheckedInRegistration } = require("../services/screening/routeAssignmentService");

const BATCH_SIZE = 100;

async function main() {
  let assigned = 0;
  let afterRegistrationId;

  for (;;) {
    const registrations = await prisma.eventRegistration.findMany({
      where: {
        ...(afterRegistrationId ? { registrationId: { gt: afterRegistrationId } } : {}),
        checkedIn: true,
        registrationStatus: "CHECKED_IN",
        event: { status: "IN_PROGRESS" },
        routeSteps: { none: {} },
      },
      select: { registrationId: true },
      orderBy: { registrationId: "asc" },
      take: BATCH_SIZE,
    });
    if (!registrations.length) break;

    for (const registration of registrations) {
      await assignCheckedInRegistration(registration.registrationId);
      assigned += 1;
    }
    afterRegistrationId = registrations.at(-1).registrationId;
  }

  console.log(`Assigned stable routes to ${assigned} checked-in registration(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
