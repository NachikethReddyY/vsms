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
) => client.$executeRaw(Prisma.sql`
  CALL "sp_vsms_cancel_active_registration_queue"(
    ${eventId}::uuid,
    ${registrationId}::uuid,
    ${cancelledAt}::timestamptz
  )
`);

module.exports = {
  cancelActiveRegistrationQueue,
  getEventQueueStatistics,
};
