const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function createRegistration(data) {

    // Check participant exists
    const participant = await prisma.participant.findUnique({
        where: {
            id: data.participantId
        }
    });

    if (!participant) {
        throw new Error("Participant not found.");
    }

    // Check event exists
    const event = await prisma.event.findUnique({
        where: {
            id: data.eventId
        }
    });

    if (!event) {
        throw new Error("Event not found.");
    }

    // Generate next queue number for this event
    const lastRegistration = await prisma.eventRegistration.findFirst({

        where: {
            eventId: data.eventId
        },

        orderBy: {
            queueNumber: "desc"
        }

    });

    const nextQueueNumber = lastRegistration
        ? lastRegistration.queueNumber + 1
        : 1;

    // Create registration
    return await prisma.eventRegistration.create({

        data: {

            participantId: data.participantId,

            eventId: data.eventId,

            queueNumber: nextQueueNumber,

            registrationStatus: "REGISTERED",

            registeredBy: data.registeredBy,

            checkedIn: false

        },

        include: {

            participant: true,

            event: true,

            registeredByUser: {
                select: {
                    id: true,
                    fullName: true,
                    email: true
                }
            }

        }

    });

}

async function getRegistration(id) {

    return await prisma.eventRegistration.findUnique({

        where: {
            id: id
        },

        include: {

            participant: true,

            event: true,

            registeredByUser: {
                select: {
                    id: true,
                    fullName: true,
                    email: true
                }
            }

        }

    });

}

async function getParticipantRegistrations(participantId) {

    return await prisma.eventRegistration.findMany({

        where: {
            participantId: participantId
        },

        include: {

            event: true

        },

        orderBy: {

            registeredAt: "desc"

        }

    });

}

async function getEventRegistrations(eventId) {

    return await prisma.eventRegistration.findMany({

        where: {
            eventId: eventId
        },

        include: {

            participant: true

        },

        orderBy: {

            queueNumber: "asc"

        }

    });

}

module.exports = {

    createRegistration,

    getRegistration,

    getParticipantRegistrations,

    getEventRegistrations

};