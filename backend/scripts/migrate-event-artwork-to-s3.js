const prisma = require("../prisma/prismaClient");
const env = require("../config/env");
const { storeArtwork } = require("../services/event/eventArtworkStorage");

async function main() {
  if (!env.eventArtworkBucket) throw new Error("EVENT_ARTWORK_BUCKET is required");
  const dryRun = process.argv.includes("--dry-run");
  const events = await prisma.event.findMany({
    where: { artworkDataUrl: { startsWith: "data:image/" } },
    select: { eventId: true, artworkDataUrl: true },
    orderBy: { eventId: "asc" },
  });
  let migrated = 0;
  for (const event of events) {
    const reference = await storeArtwork(event.artworkDataUrl);
    if (!dryRun) {
      const result = await prisma.event.updateMany({
        where: { eventId: event.eventId, artworkDataUrl: event.artworkDataUrl },
        data: { artworkDataUrl: reference },
      });
      migrated += result.count;
    }
  }
  console.log(JSON.stringify({ bucket: env.eventArtworkBucket, candidates: events.length, migrated, dryRun }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
