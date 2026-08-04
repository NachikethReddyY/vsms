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
 * Get queue status for a specific individual participant.
 */
const getQueueByParticipantId = async (participantId) => {
    if (!participantId) {
        throw new AppError(400, "PARTICIPANT_ID_REQUIRED", "Participant ID is required.");
    }

    return await prisma.queue.findFirst({
        where: { participantId },
        include: {
            event: { select: { id: true, title: true } },
            station: { select: { id: true, name: true } },
        },
    });
};

/**
 * Add a participant into a queue line for an event.
 */
const addParticipantToQueue = async (eventId, participantId, initialStationId) => {
    if (!eventId || !participantId) {
        throw new AppError(400, "MISSING_REQUIRED_FIELDS", "Event ID and Participant ID are required.");
    }

    const lastInQueue = await prisma.queue.findFirst({
        where: { eventId },
        orderBy: { position: "desc" },
    });

    const nextPosition = lastInQueue ? lastInQueue.position + 1 : 1;

    return await prisma.queue.create({
        data: {
            eventId,
            participantId,
            stationId: initialStationId || null,
            position: nextPosition,
            status: "WAITING",
        },
        include: { participant: true, station: true },
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

/**
 * Remove or cancel a participant from an active queue.
 */
const removeQueueItem = async (queueId) => {
    if (!queueId) {
        throw new AppError(400, "QUEUE_ID_REQUIRED", "Queue ID is required.");
    }

    return await prisma.queue.delete({
        where: { id: queueId },
        include: { participant: true },
    });
};

module.exports = {
    getQueueByEventId,
    getQueueByParticipantId,
    addParticipantToQueue,
    advanceQueuePosition,
    removeQueueItem,
};