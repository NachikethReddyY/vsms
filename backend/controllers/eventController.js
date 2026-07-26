const prisma = require("../prisma/prismaClient");
const asyncHandler = require("../middlewares/asyncHandler");

exports.getActiveEvents = asyncHandler(async (req, res) => {
    const events = await prisma.event.findMany({
        where: {
            status: {
                in: ["PUBLISHED", "UPCOMING", "ONGOING", "IN_PROGRESS"],
            },
        },
        orderBy: [
            { eventDate: "asc" },
            { startTime: "asc" },
        ],
    });

    res.json({
        events,
    });
});

exports.getEventById = asyncHandler(async (req, res) => {
    const event = await prisma.event.findUnique({
        where: {
            id: req.params.eventId,
        },
    });

    if (!event) {
        return res.status(404).json({
            error: "Event not found",
            requestId: req.context.requestId,
        });
    }

    res.json({
        event,
    });
});
