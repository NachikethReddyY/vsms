const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");
const { logAudit } = require("../utils/auditLogger");

/**
 * Get queue items by event ID.
 */
const getQueueByEventId = async (eventId) => {
    if (!eventId) {
        throw new AppError(400, "EVENT_ID_REQUIRED", "Event ID is required.");
    }

    return await prisma.queue.findMany({
        where: { eventId },
        include: {
            participant: { select: { id: true, fullName: true, email: true } },
            station: { select: { id: true, name: true } },
        },
        orderBy: { position: "asc" },
    });
};

/**
 * Advance a queue item position, update its station/status, and write an audit log.
 */
const advanceQueuePosition = async (queueId, nextStationId, status, reqUser, reqIp) => {
    if (!queueId) {
        throw new AppError(400, "QUEUE_ID_REQUIRED", "Queue ID is required.");
    }

    const updatedItem = await prisma.queue.update({
        where: { id: queueId },
        data: {
            stationId: nextStationId || null,
            status: status || "IN_PROGRESS",
        },
        include: { participant: true, station: true },
    });

    // Emit required audit trail log
    await logAudit(
        reqUser?.id,
        "QUEUE_ADVANCED",
        "QUEUE",
        { queueId, participantId: updatedItem.participantId, nextStationId },
        reqIp || "::1"
    );

    return updatedItem;
};

module.exports = {
    getQueueByEventId,
    advanceQueuePosition,
};