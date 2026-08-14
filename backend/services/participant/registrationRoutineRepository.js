const firstRow = (rows, routineName) => {
    if (rows[0]) return rows[0];
    throw new Error(`${routineName} returned no result`);
};

const registerParticipant = async (db, {
    participantId,
    eventId,
    registeredBy,
    idempotencyKey,
}) => firstRow(
    await db.$queryRaw`
        SELECT * FROM public.register_participant_for_event(
            CAST(${participantId} AS uuid),
            CAST(${eventId} AS uuid),
            CAST(${registeredBy} AS uuid),
            ${idempotencyKey}
        )
    `,
    "register_participant_for_event"
);

const cancelRegistration = async (db, {
    registrationId,
    changedBy,
    reason,
}) => firstRow(
    await db.$queryRaw`
        SELECT * FROM public.cancel_event_registration(
            CAST(${registrationId} AS uuid),
            CAST(${changedBy} AS uuid),
            ${reason || null}
        )
    `,
    "cancel_event_registration"
);

const checkInRegistration = async (db, {
    registrationId,
    eventId,
    changedBy,
}) => firstRow(
    await db.$queryRaw`
        SELECT * FROM public.check_in_event_registration(
            CAST(${registrationId} AS uuid),
            CAST(${eventId} AS uuid),
            CAST(${changedBy} AS uuid)
        )
    `,
    "check_in_event_registration"
);

const getEventSummary = async (db, eventId) => {
    const rows = await db.$queryRaw`
        SELECT * FROM public.get_event_registration_summary(
            CAST(${eventId} AS uuid)
        )
    `;
    return rows[0] || null;
};

module.exports = {
    cancelRegistration,
    checkInRegistration,
    getEventSummary,
    registerParticipant,
};
