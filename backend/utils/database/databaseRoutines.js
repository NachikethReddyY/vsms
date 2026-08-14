const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma/prismaClient");

const getEventQueueStatistics = (eventId, from, to, client = prisma) => client.$queryRaw(Prisma.sql`
  SELECT *
  FROM "vsms_event_queue_statistics"(
    ${eventId}::uuid,
    ${from}::timestamptz,
    ${to}::timestamptz
  )
`);

const cancelActiveRegistrationQueue = (
  eventId,
  registrationId,
  cancelledAt,
  client = prisma,
) => client.$queryRaw(Prisma.sql`
  CALL "sp_vsms_cancel_active_registration_queue"(
    ${eventId}::uuid,
    ${registrationId}::uuid,
    ${cancelledAt}::timestamptz,
    NULL
  )
`).then(([result]) => ({ count: Number(result?.p_cancelled_count || 0) }));

const isRegistrationRouteComplete = async (
  eventId,
  registrationId,
  client = prisma,
) => {
  const [result] = await client.$queryRaw(Prisma.sql`
    SELECT "vsms_registration_route_complete"(
      ${eventId}::uuid,
      ${registrationId}::uuid
    ) AS complete
  `);
  return result?.complete === true;
};

module.exports = {
  cancelActiveRegistrationQueue,
  getEventQueueStatistics,
  isRegistrationRouteComplete,
};
