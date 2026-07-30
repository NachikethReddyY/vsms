const prisma = require("../prisma/prismaClient");

const getQueueByEventId = async (eventId) => {
  return await prisma.queue.findMany({
    where: { eventId },
    include: {
      participant: { select: { id: true, fullName: true, email: true } },
      station: { select: { id: true, name: true } },
    },
    orderBy: { position: "asc" },
  });
};

const updateQueuePosition = async (queueId, nextStationId, status) => {
  return await prisma.queue.update({
    where: { id: queueId },
    data: {
      stationId: nextStationId || null,
      status: status || "IN_PROGRESS",
    },
    include: { participant: true, station: true },
  });
};

module.exports = {
  getQueueByEventId,
  updateQueuePosition,
};