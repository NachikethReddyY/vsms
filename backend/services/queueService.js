const prisma = require("../prisma/prismaClient");
const pool = require("../config/db"); // Raw pg pool connection for stored procedures
const AppError = require("../errors/AppError");
const { logAudit } = require("../utils/auditLogger");

/**
 * 1. Get queue items by event ID (Prisma ORM)
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
 * 2. Get queue status for a specific individual participant (Prisma ORM)
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
 * 3. Add a participant into a queue line for an event (Prisma ORM)
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
 * 4. Advance a queue item position via Prisma ORM
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
 * 5. Transfer a participant using the PostgreSQL Stored Procedure (Raw pg + Stored Procedure Call)
 */
const transferParticipantProcedure = async ({ participantId, currentStation, nextStation, performedBy, reqIp }) => {
    if (!participantId || !currentStation) {
        throw new AppError(400, "MISSING_TRANSFER_FIELDS", "Participant ID and current station are required.");
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Execute the database-level stored procedure
        await client.query(
            "CALL sp_transfer_participant($1, $2, $3, $4)",
            [participantId, currentStation, nextStation || null, performedBy]
        );

        await client.query("COMMIT");

        // Log the stored procedure action into the system audit trail
        await logAudit(
            performedBy,
            "QUEUE_TRANSFERRED_SP",
            "QUEUE",
            { participantId, currentStation, nextStation },
            reqIp || "::1"
        );

        return { success: true, message: "Participant station transfer completed via stored procedure." };
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Stored Procedure Transfer Failed:", error);
        throw new AppError(500, "TRANSFER_PROCEDURE_ERROR", "Failed to process station queue transfer.");
    } finally {
        client.release();
    }
};

/**
 * 6. Remove or cancel a participant from an active queue (Prisma ORM)
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
    transferParticipantProcedure,
    removeQueueItem,
};