const prisma = require("../prisma/prismaClient");
const { protectParticipantNric } = require("../utils/crypto/participantIdentity");

const BATCH_SIZE = 100;

async function backfillParticipantNric(db = prisma) {
  let migrated = 0;

  for (;;) {
    const rows = await db.participant.findMany({
      where: { nric: { not: null }, nricCiphertext: null, nricLookupHash: null },
      select: { id: true, nric: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (!rows.length) break;

    await db.$transaction(async (tx) => {
      for (const row of rows) {
        const changed = await tx.participant.updateMany({
          where: { id: row.id, nric: row.nric, nricCiphertext: null, nricLookupHash: null },
          data: protectParticipantNric(row.id, row.nric),
        });
        if (changed.count !== 1) throw new Error("Participant NRIC changed during backfill; retry the migration");
      }
    });
    migrated += rows.length;
  }

  const remainingLegacyRows = await db.participant.count({ where: { nric: { not: null } } });
  const incompleteEncryptedRows = await db.participant.count({
    where: {
      OR: [
        { nricCiphertext: null },
        { nricLookupHash: null },
        { nricEncryptionVersion: { not: 2 } },
      ],
    },
  });
  if (remainingLegacyRows || incompleteEncryptedRows) {
    throw new Error(`NRIC backfill incomplete: ${remainingLegacyRows} legacy and ${incompleteEncryptedRows} incomplete rows remain`);
  }

  return { migrated, remainingLegacyRows, incompleteEncryptedRows };
}

if (require.main === module) {
  backfillParticipantNric()
    .then((result) => process.stdout.write(`Participant NRIC backfill complete: ${result.migrated} rows migrated\n`))
    .finally(() => prisma.$disconnect());
}

module.exports = { backfillParticipantNric };
