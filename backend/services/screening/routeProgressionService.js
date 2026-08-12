const AppError = require("../../errors/AppError");

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_PROGRESS"];

const allocateQueueNumber = async (tx, registration) => {
  if (registration.queueNumber != null) return registration.queueNumber;

  const aggregate = await tx.eventRegistration.aggregate({
    where: { eventId: registration.eventId },
    _max: { queueNumber: true },
  });
  const queueNumber = (aggregate._max.queueNumber || 0) + 1;
  await tx.eventRegistration.update({
    where: { registrationId: registration.registrationId },
    data: { queueNumber },
  });
  return queueNumber;
};

/** The only route service permitted to create the first or next active queue entry. */
const createInitialQueueEntry = async ({ tx, registrationId, stationId }) => {
  if (!stationId) return null;

  const existing = await tx.queueEntry.findFirst({
    where: { registrationId, status: { in: ACTIVE_QUEUE_STATUSES } },
    orderBy: { enteredAt: "desc" },
  });
  if (existing) {
    if (existing.stationId === stationId) return existing;
    throw new AppError(
      409,
      "ROUTE_QUEUE_CONFLICT",
      "The participant already has an active queue entry for another station.",
    );
  }

  const registration = await tx.eventRegistration.findUnique({
    where: { registrationId },
    select: {
      registrationId: true,
      eventId: true,
      queueNumber: true,
      registrationStatus: true,
    },
  });
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Event registration not found.");
  }
  if (["COMPLETED", "CANCELLED"].includes(registration.registrationStatus)) {
    throw new AppError(409, "REGISTRATION_NOT_QUEUEABLE", "Completed or cancelled registrations cannot join a queue.");
  }

  const queueNumber = await allocateQueueNumber(tx, registration);
  return tx.queueEntry.create({
    data: {
      registrationId,
      stationId,
      queueNumber,
      status: "WAITING",
    },
  });
};

module.exports = {
  ACTIVE_QUEUE_STATUSES,
  createInitialQueueEntry,
};
