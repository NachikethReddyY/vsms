const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const cols = await p.$queryRawUnsafe(
    `SELECT column_name, column_default
     FROM information_schema.columns
     WHERE table_name = 'qr_pass_events'
     ORDER BY ordinal_position`
  );
  console.log(JSON.stringify(cols, null, 0));
  const fn = await p.$queryRawUnsafe(
    `SELECT prosrc FROM pg_proc WHERE proname = 'prevent_qr_pass_event_mutation'`
  );
  console.log("FUNC:", JSON.stringify(fn, null, 0));
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); });
