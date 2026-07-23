const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// ==========================================
// Create Event
// ==========================================
async function createEvent(data) {

    return await prisma.event.create({

        data: {
            eventName: data.eventName,
            location: data.location,
            eventDate: new Date(data.eventDate),
            startTime: new Date(data.startTime),
            endTime: new Date(data.endTime),
            status: data.status || "UPCOMING"
        }

    });

}

// ==========================================
// Get All Events
// ==========================================
async function getAllEvents() {

    return await prisma.event.findMany({

        orderBy: {
            eventDate: "asc"
        }

    });

}

// ==========================================
// Get Event By ID
// ==========================================
async function getEventById(id) {

    return await prisma.event.findUnique({

        where: {
            id
        }

    });

}

// ==========================================
// Update Event
// ==========================================
async function updateEvent(id, data) {

    return await prisma.event.update({

        where: {
            id
        },

        data: {
            eventName: data.eventName,
            location: data.location,
            eventDate: data.eventDate
                ? new Date(data.eventDate)
                : undefined,
            startTime: data.startTime
                ? new Date(data.startTime)
                : undefined,
            endTime: data.endTime
                ? new Date(data.endTime)
                : undefined,
            status: data.status
        }

    });

}

// ==========================================
// Delete Event
// ==========================================
async function deleteEvent(id) {

    return await prisma.event.delete({

        where: {
            id
        }

    });

}

module.exports = {
    createEvent,
    getAllEvents,
    getEventById,
    updateEvent,
    deleteEvent
};