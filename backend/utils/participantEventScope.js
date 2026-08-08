const { assertUuid } = require("./validation");

function participantEventScopeWhere(eventId, userId) {
    return {
        OR: [
            // Event registrations are the only durable, server-trusted event membership.
            { eventRegistrations: { some: { eventId } } },
            // An authorized reuse decision creates a durable target-event intake
            // before consent and the final registration are completed.
            { eventIntakes: { some: { eventId } } },
            // Before registration, only the officer who created the participant for this
            // exact event may complete that one onboarding flow. Consent never creates scope.
            {
                AND: [
                    { createdById: userId },
                    { onboardingEventId: eventId },
                    { eventRegistrations: { none: {} } },
                ],
            },
        ],
    };
}

async function assertParticipantEventScope(db, participantIdParam, eventIdParam, userId) {
    const participantId = assertUuid(participantIdParam, "participantId");
    const eventId = assertUuid(eventIdParam, "X-Event-Id");
    const participant = await db.participant.findFirst({
        where: {
            id: participantId,
            ...participantEventScopeWhere(eventId, userId),
        },
        select: { id: true },
    });
    if (!participant) {
        const error = new Error("Participant is outside the assigned event");
        error.statusCode = 403;
        throw error;
    }
    return participant.id;
}

module.exports = { assertParticipantEventScope, participantEventScopeWhere };
