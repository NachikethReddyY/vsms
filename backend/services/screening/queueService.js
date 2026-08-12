const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const { createAuditLog } = require("../../utils/logging/audit");
const {
  requireQueueAccess,
} = require("../event/eventAuthorizationService");

const ACTIVE_QUEUE_STATUSES = [
  "WAITING",
  "CALLED",
  "IN_PROGRESS",
];

const stationCapacity = (station, capacities) => Math.max(
  1,
  Number(capacities.get(station.stationId)) ||
    Number(station.stationTemplate?.defaultCapacity) ||
    1
);
const occupancyPercent = (activeQueueCount, capacity) => Math.round((activeQueueCount / capacity) * 100);

/**
 * Determine the current operational status of a station.
 */
const stationStatus = (station, activeQueueCount = 0) => {
  if (
    !station.isActive ||
    station.operationalStatus === "OFFLINE"
  ) {
    return "OFFLINE";
  }

  if (station.operationalStatus === "PAUSED") {
    return "PAUSED";
  }

  return station.operationalStatus === "BUSY" ||
    activeQueueCount > 0
    ? "BUSY"
    : "AVAILABLE";
};

/**
 * Ensure a station can accept a queue entry.
 */
const assertStationSelectable = (station, activeQueueCount = 0) => {
  const status = stationStatus(station, activeQueueCount);

  if (status === "PAUSED" || status === "OFFLINE") {
    throw new AppError(
      409,
      "STATION_UNAVAILABLE",
      "The selected station is no longer available",
      { status }
    );
  }

  return status;
};

/**
 * Response returned when a participant is handed off to another station.
 */
const handoffResponse = ({
  registration,
  station,
  queueEntry,
  created,
  stationStatusBeforeHandoff,
}) => ({
  created,

  registrationId: registration.registrationId,

  queueEntryId: queueEntry.id,

  participant: {
    id: registration.participant.id,
    participantReference:
      registration.participant.participantReference,
    name: `${registration.participant.firstName} ${registration.participant.lastName}`,
  },

  event: {
    id: registration.event.eventId,
    name: registration.event.name,
  },

  queueNumber: queueEntry.queueNumber,

  nextStation: station.stationName,

  assignedStation: {
    id: station.stationId,
    name: station.stationName,
    status: "BUSY",
    statusBeforeHandoff: stationStatusBeforeHandoff,
  },
});

/**
 * Validate that the event is available for queue management.
 */
const requireQueueManagement = async (
  db,
  eventId,
  user,
  stationId = null
) => {
  await requireQueueAccess(eventId, user, {
    db,
    stationId,
  });

  const event = await db.event.findUnique({
    where: {
      eventId,
    },
    select: {
      eventId: true,
      name: true,
      status: true,
      venue: true,
    },
  });

  if (!event) {
    throw new AppError(
      404,
      "EVENT_NOT_FOUND",
      "Event not found"
    );
  }

  if (event.status !== "IN_PROGRESS") {
    throw new AppError(
      409,
      "EVENT_NOT_IN_PROGRESS",
      "Queue operations are available only while the event is in progress"
    );
  }

  return event;
};

/**
 * Validate that a user is allowed to operate a particular station.
 */
const requireQueueStationOperation = async (
  db,
  eventId,
  stationId,
  user
) => {
  const authorization = await requireQueueAccess(
    eventId,
    user,
    {
      db,
      stationId,
    }
  );

  const station = await db.station.findFirst({
    where: {
      stationId,
      eventId,
      isActive: true,
    },
  });

  if (!station) {
    throw new AppError(
      404,
      "STATION_NOT_FOUND",
      "Station not found for this event"
    );
  }

  return {
    event: authorization.event,
    station,
  };
};

/**
 * Load a queue entry together with the related registration,
 * participant and station information.
 */
const loadQueueEntry = async (db, queueId) => {
  const entry = await db.queueEntry.findUnique({
    where: {
      id: queueId,
    },

    include: {
      registration: {
        select: {
          registrationId: true,
          eventId: true,
          participantDisplayName: true,

          participant: {
            select: {
              id: true,
              participantReference: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },

      station: {
        select: {
          stationId: true,
          stationName: true,
          stationType: true,
        },
      },
    },
  });

  if (!entry) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found"
    );
  }

  return entry;
};

/**
 * Priority-first queue ordering.
 *
 * Priority entries are always served before routine entries.
 * Within the same priority level:
 *
 * 1. Queue number
 * 2. Entered time
 */
const waitingOrder = (entries) =>
  entries
    .filter(
      (entry) => entry.status === "WAITING"
    )
    .sort((a, b) => {
      if (a.isPriority !== b.isPriority) {
        return a.isPriority ? -1 : 1;
      }

      if (a.queueNumber !== b.queueNumber) {
        return a.queueNumber - b.queueNumber;
      }

      return (
        new Date(a.enteredAt).getTime() -
        new Date(b.enteredAt).getTime()
      );
    });

/**
 * Convert a queue entry into a safe API response object.
 */
const serializeQueueEntry = (entry) => ({
  id: entry.id,

  queueNumber: entry.queueNumber,

  status: entry.status,

  isPriority: entry.isPriority,

  priorityNotes: entry.priorityNotes,

  registrationId: entry.registrationId,

  participantDisplayName:
    entry.registration?.participantDisplayName ||
    "Unnamed participant",

  participantReference:
    entry.registration?.participant?.participantReference ||
    null,

  stationId: entry.stationId,

  stationName:
    entry.station?.stationName || null,

  stationType:
    entry.station?.stationType || null,

  enteredAt: entry.enteredAt,

  calledAt: entry.calledAt,

  startedAt: entry.startedAt,

  leftQueueAt: entry.leftQueueAt,

  completedAt: entry.completedAt,
});

/**
 * Add a registration to a station queue.
 *
 * Serializable isolation is used to prevent concurrent requests
 * from generating duplicate queue positions.
 */
const joinQueue = async (
  {
    eventId,
    stationId,
    registrationId,
  },
  user,
  context = null,
  db = prisma
) => {
  await requireQueueManagement(
    db,
    eventId,
    user,
    stationId
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const station = await tx.station.findFirst({
            where: {
              stationId,
              eventId,
              isActive: true,
            },
          });

          if (!station) {
            throw new AppError(
              404,
              "STATION_NOT_FOUND",
              "Station not found for this event"
            );
          }

          assertStationSelectable(station);

          const registration =
            await tx.eventRegistration.findFirst({
              where: {
                registrationId,
                eventId,
              },
            });

          if (!registration) {
            throw new AppError(
              404,
              "REGISTRATION_NOT_FOUND",
              "Registration not found for this event"
            );
          }

          if (
            ["COMPLETED", "CANCELLED"].includes(
              registration.registrationStatus
            )
          ) {
            throw new AppError(
              409,
              "REGISTRATION_NOT_QUEUEABLE",
              "Completed or cancelled registrations cannot join a queue"
            );
          }

          const existing =
            await tx.queueEntry.findFirst({
              where: {
                registrationId,
                status: {
                  in: ACTIVE_QUEUE_STATUSES,
                },
              },

              orderBy: {
                enteredAt: "desc",
              },
            });

          if (existing) {
            if (
              existing.stationId === stationId
            ) {
              return {
                queueEntry: existing,
                created: false,
              };
            }

            throw new AppError(
              409,
              "ALREADY_IN_QUEUE",
              "Registration is already in an active queue at another station",
              {
                queueEntryId: existing.id,
                stationId: existing.stationId,
              }
            );
          }

          let queueNumber =
            registration.queueNumber;

          if (queueNumber == null) {
            const aggregate =
              await tx.eventRegistration.aggregate({
                where: {
                  eventId,
                },

                _max: {
                  queueNumber: true,
                },
              });

            queueNumber =
              (aggregate._max.queueNumber || 0) + 1;

            await tx.eventRegistration.update({
              where: {
                registrationId,
              },

              data: {
                queueNumber,
              },
            });
          }

          const queueEntry =
            await tx.queueEntry.create({
              data: {
                registrationId,
                stationId,
                queueNumber,
                status: "WAITING",
              },
            });

          await createAuditLog({
            userId: user.userId,

            action: "QUEUE_JOINED",

            entityName: "QueueEntry",

            entityId: queueEntry.id,

            newValue: {
              eventId,
              stationId,
              registrationId,
              queueNumber,
              status: "WAITING",
            },

            context,

            client: tx,
          });

          return {
            queueEntry,
            created: true,
          };
        },

        {
          isolationLevel: "Serializable",
        }
      );
    } catch (error) {
      const target = JSON.stringify(
        error.meta?.target || ""
      );

      if (
        (
          error.code === "P2034" ||
          (
            error.code === "P2002" &&
            target.includes("queue")
          )
        ) &&
        attempt < 3
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError(
    409,
    "QUEUE_JOIN_CONFLICT",
    "Unable to reserve a queue position. Please try again."
  );
};

/**
 * Return all stations available for registration handoff.
 */
const listRegistrationStations = async (
  eventId,
  user,
  db = prisma
) => {
  const event = await requireQueueManagement(
    db,
    eventId,
    user
  );

  const now = new Date();
  const [stations, activeEntries, availabilities] =
    await Promise.all([
       db.station.findMany({
         where: {
           eventId,
         },

         include: {
           stationTemplate: {
             select: {
               defaultCapacity: true,
             },
           },
         },

        orderBy: [
          {
            stationOrder: "asc",
          },

          {
            stationId: "asc",
          },
        ],
      }),

       db.queueEntry.findMany({
        where: {
          station: {
            eventId,
          },

          status: {
            in: ACTIVE_QUEUE_STATUSES,
          },
        },

        select: {
          stationId: true,
         },
       }),

       db.eventStationAvailability.findMany({
         where: {
           eventDay: {
             eventId,
             startsAt: { lte: now },
             endsAt: { gt: now },
           },
         },

         select: {
           eventStationId: true,
           capacity: true,
         },
       }),
     ]);
  const capacities = new Map(
    availabilities.map(({ eventStationId, capacity }) => [
      eventStationId,
      capacity,
    ])
  );
  const activeCounts = new Map();

  for (const entry of activeEntries) {
    activeCounts.set(
      entry.stationId,
      (activeCounts.get(entry.stationId) || 0) + 1
    );
  }

  return {
    event,

    stations: stations.map((station) => {
      const activeQueueCount =
        activeCounts.get(station.stationId) || 0;

      const status = stationStatus(
        station,
        activeQueueCount
      );
      const capacity = stationCapacity(
        station,
        capacities
      );
      return {
        stationId: station.stationId,

        stationName: station.stationName,

        stationType: station.stationType,

        stationOrder: station.stationOrder,

        status,

        activeQueueCount,
        capacity,

        occupancyPercent: occupancyPercent(
          activeQueueCount,
          capacity
        ),

        selectable:
          status === "AVAILABLE" ||
          status === "BUSY",
      };
    }),
  };
};

/**
 * Create a queue handoff to another station.
 */
const createQueueHandoff = async (
  {
    eventId,
    stationId,
    registrationId,
  },
  user,
  context = null,
  db = prisma
) => {
  await requireQueueManagement(
    db,
    eventId,
    user,
    stationId
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const registration =
            await tx.eventRegistration.findFirst({
              where: {
                registrationId,
                eventId,
              },

              include: {
                participant: {
                  select: {
                    id: true,
                    participantReference: true,
                    firstName: true,
                    lastName: true,
                  },
                },

                event: {
                  select: {
                    eventId: true,
                    name: true,
                  },
                },
              },
            });

          if (!registration) {
            throw new AppError(
              404,
              "REGISTRATION_NOT_FOUND",
              "Registration not found for this event"
            );
          }

          if (
            ["COMPLETED", "CANCELLED"].includes(
              registration.registrationStatus
            )
          ) {
            throw new AppError(
              409,
              "REGISTRATION_NOT_QUEUEABLE",
              "Completed or cancelled registrations cannot join a queue"
            );
          }

          const station =
            await tx.station.findFirst({
              where: {
                stationId,
                eventId,
                isActive: true,
              },
            });

          if (!station) {
            throw new AppError(
              404,
              "STATION_NOT_FOUND",
              "Station not found for this event"
            );
          }

          const stationStatusBeforeHandoff =
            assertStationSelectable(station);

          const existing =
            await tx.queueEntry.findFirst({
              where: {
                registrationId,

                status: {
                  in: ACTIVE_QUEUE_STATUSES,
                },
              },

              orderBy: {
                enteredAt: "desc",
              },
            });

          if (existing) {
            if (
              existing.stationId === stationId
            ) {
              return handoffResponse({
                registration,
                station,
                queueEntry: existing,
                created: false,
                stationStatusBeforeHandoff,
              });
            }

            throw new AppError(
              409,
              "ALREADY_IN_QUEUE",
              "Registration is already in an active queue",
              {
                queueEntryId: existing.id,
                stationId: existing.stationId,
              }
            );
          }

          let queueNumber =
            registration.queueNumber;

          if (queueNumber == null) {
            const aggregate =
              await tx.eventRegistration.aggregate({
                where: {
                  eventId,
                },

                _max: {
                  queueNumber: true,
                },
              });

            queueNumber =
              (aggregate._max.queueNumber || 0) + 1;

            await tx.eventRegistration.update({
              where: {
                registrationId,
              },

              data: {
                queueNumber,
              },
            });
          }

          const queueEntry =
            await tx.queueEntry.create({
              data: {
                registrationId,
                stationId,
                queueNumber,
                status: "WAITING",
              },
            });

          await createAuditLog({
            userId: user.userId,

            action:
              "REGISTRATION_QUEUE_HANDOFF_CREATED",

            entityName: "QueueEntry",

            entityId: queueEntry.id,

            newValue: {
              eventId,
              stationId,
              registrationId,
              queueNumber,
              stationStatusBeforeHandoff,
            },

            context,

            client: tx,
          });

          return handoffResponse({
            registration,
            station,
            queueEntry,
            created: true,
            stationStatusBeforeHandoff,
          });
        },

        {
          isolationLevel: "Serializable",
        }
      );
    } catch (error) {
      const target = JSON.stringify(
        error.meta?.target || ""
      );

      if (
        (
          error.code === "P2034" ||
          (
            error.code === "P2002" &&
            target.includes("queue")
          )
        ) &&
        attempt < 3
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError(
    409,
    "QUEUE_HANDOFF_CONFLICT",
    "Unable to reserve a queue position. Please select a station again."
  );
};

/**
 * Get overall queue status for an event.
 */
const getEventQueueStatus = async (
  eventId,
  user,
  db = prisma
) => {
  const event = await requireQueueManagement(
    db,
    eventId,
    user
  );

  const [stations, entries] =
    await Promise.all([
      db.station.findMany({
        where: {
          eventId,
          isActive: true,
        },

        orderBy: [
          {
            stationOrder: "asc",
          },

          {
            stationId: "asc",
          },
        ],
      }),

      db.queueEntry.findMany({
        where: {
          station: {
            eventId,
          },
        },

        include: {
          registration: {
            select: {
              participantDisplayName: true,

              participant: {
                select: {
                  participantReference: true,
                },
              },
            },
          },

          station: {
            select: {
              stationName: true,
              stationType: true,
            },
          },
        },

        orderBy: [
          {
            queueNumber: "asc",
          },

          {
            enteredAt: "asc",
          },
        ],
      }),
    ]);

  const byStation = new Map(
    stations.map((station) => [
      station.stationId,

      {
        stationId: station.stationId,

        workload: {
          WAITING: 0,
          CALLED: 0,
          IN_PROGRESS: 0,
          COMPLETED: 0,
          SKIPPED: 0,
          CANCELLED: 0,
        },

        nextUp: null,
      },
    ])
  );

  for (const entry of entries) {
    const bucket = byStation.get(
      entry.stationId
    );

    if (!bucket) {
      continue;
    }

    if (bucket.workload[entry.status] !== undefined) {
      bucket.workload[entry.status] += 1;
    }
  }

  for (const bucket of byStation.values()) {
    const next = waitingOrder(
      entries.filter(
        (entry) =>
          entry.stationId === bucket.stationId
      )
    )[0];

    if (next) {
      bucket.nextUp = {
        queueId: next.id,

        queueNumber: next.queueNumber,

        registrationId:
          next.registrationId,

        participantDisplayName:
          next.registration
            ?.participantDisplayName ||
          "Unnamed participant",

        isPriority: next.isPriority,
      };
    }
  }

  const orderedEntries = [...entries].sort(
    (a, b) => {
      if (
        a.queueNumber !== b.queueNumber
      ) {
        return (
          a.queueNumber - b.queueNumber
        );
      }

      const byTime =
        new Date(a.enteredAt).getTime() -
        new Date(b.enteredAt).getTime();

      return (
        byTime ||
        String(a.id).localeCompare(
          String(b.id)
        )
      );
    }
  );

  return {
    event,

    stations: [...byStation.values()],

    entries: orderedEntries.map(
      serializeQueueEntry
    ),
  };
};

/**
 * Get queue status and queue history for one registration.
 */
const getParticipantQueueStatus = async (
  eventId,
  registrationId,
  user,
  db = prisma
) => {
  if (!eventId) {
    const scoped =
      await db.eventRegistration.findUnique({
        where: {
          registrationId,
        },

        select: {
          eventId: true,
        },
      });

    if (!scoped) {
      throw new AppError(
        404,
        "REGISTRATION_NOT_FOUND",
        "Registration not found"
      );
    }

    eventId = scoped.eventId;
  }

  await requireQueueManagement(
    db,
    eventId,
    user
  );

  const registration =
    await db.eventRegistration.findFirst({
      where: {
        registrationId,
        eventId,
      },
    });

  if (!registration) {
    throw new AppError(
      404,
      "REGISTRATION_NOT_FOUND",
      "Registration not found for this event"
    );
  }

  const entries =
    await db.queueEntry.findMany({
      where: {
        registrationId,
      },

      orderBy: [
        {
          enteredAt: "desc",
        },

        {
          id: "desc",
        },
      ],

      include: {
        station: {
          select: {
            stationId: true,
            stationName: true,
            stationType: true,
          },
        },

        screeningResults: {
          select: {
            resultId: true,
            overallFlag: true,
          },
        },
      },
    });

  const activeEntry =
    entries.find((entry) =>
      ACTIVE_QUEUE_STATUSES.includes(
        entry.status
      )
    ) || null;

  return {
    registrationId,

    queueNumber:
      registration.queueNumber,

    status:
      registration.registrationStatus,

    activeEntry,

    history: entries,
  };
};

/**
 * Call a waiting queue entry.
 */
const callQueueEntry = async (
  queueId,
  user,
  context = null,
  db = prisma,
  expectedEventId = null
) => {
  const entry = await loadQueueEntry(
    db,
    queueId
  );

  if (
    expectedEventId &&
    entry.registration.eventId !==
      expectedEventId
  ) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found for this event"
    );
  }

  await requireQueueStationOperation(
    db,
    entry.registration.eventId,
    entry.stationId,
    user
  );

  return db.$transaction(async (tx) => {
    const current =
      await tx.queueEntry.findUnique({
        where: {
          id: queueId,
        },
      });

    if (!current) {
      throw new AppError(
        404,
        "QUEUE_ENTRY_NOT_FOUND",
        "Queue entry not found"
      );
    }

    if (current.status !== "WAITING") {
      throw new AppError(
        409,
        "INVALID_QUEUE_STATE",
        "Only a WAITING queue entry can be called",
        {
          status: current.status,
        }
      );
    }

    const updated =
      await tx.queueEntry.update({
        where: {
          id: queueId,
        },

        data: {
          status: "CALLED",
          calledAt: new Date(),
        },
      });

    await createAuditLog({
      userId: user.userId,

      action: "QUEUE_CALLED",

      entityName: "QueueEntry",

      entityId: queueId,

      oldValue: {
        status: "WAITING",
      },

      newValue: {
        status: "CALLED",
      },

      context,

      client: tx,
    });

    return updated;
  });
};

/**
 * Start a called queue entry.
 */
const startQueueEntry = async (
  queueId,
  user,
  context = null,
  db = prisma,
  expectedEventId = null
) => {
  const entry = await loadQueueEntry(
    db,
    queueId
  );

  if (
    expectedEventId &&
    entry.registration.eventId !==
      expectedEventId
  ) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found for this event"
    );
  }

  await requireQueueStationOperation(
    db,
    entry.registration.eventId,
    entry.stationId,
    user
  );

  return db.$transaction(async (tx) => {
    const current =
      await tx.queueEntry.findUnique({
        where: {
          id: queueId,
        },
      });

    if (!current) {
      throw new AppError(
        404,
        "QUEUE_ENTRY_NOT_FOUND",
        "Queue entry not found"
      );
    }

    if (current.status !== "CALLED") {
      throw new AppError(
        409,
        "INVALID_QUEUE_STATE",
        "Only a CALLED queue entry can be started",
        {
          status: current.status,
        }
      );
    }

    const updated =
      await tx.queueEntry.update({
        where: {
          id: queueId,
        },

        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
        },
      });

    await createAuditLog({
      userId: user.userId,

      action: "QUEUE_STARTED",

      entityName: "QueueEntry",

      entityId: queueId,

      oldValue: {
        status: "CALLED",
      },

      newValue: {
        status: "IN_PROGRESS",
      },

      context,

      client: tx,
    });

    return updated;
  });
};

/**
 * Transfer a participant from one station to another.
 */
const advanceQueueEntry = async (
  {
    queueId,
    toStationId,
    reason = "STATION_TRANSFER",
    eventId = null,
  },
  user,
  context = null,
  db = prisma
) => {
  const entry = await loadQueueEntry(
    db,
    queueId
  );

  if (
    eventId &&
    entry.registration.eventId !== eventId
  ) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found for this event"
    );
  }

  await requireQueueStationOperation(
    db,
    entry.registration.eventId,
    entry.stationId,
    user
  );

  return db.$transaction(async (tx) => {
    const current =
      await tx.queueEntry.findUnique({
        where: {
          id: queueId,
        },
      });

    if (!current) {
      throw new AppError(
        404,
        "QUEUE_ENTRY_NOT_FOUND",
        "Queue entry not found"
      );
    }

    if (current.status !== "IN_PROGRESS") {
      throw new AppError(
        409,
        "INVALID_QUEUE_STATE",
        "Only an IN_PROGRESS queue entry can be transferred",
        {
          status: current.status,
        }
      );
    }

    const targetStation =
      await tx.station.findFirst({
        where: {
          stationId: toStationId,

          eventId:
            entry.registration.eventId,

          isActive: true,
        },
      });

    if (!targetStation) {
      throw new AppError(
        404,
        "STATION_NOT_FOUND",
        "Target station not found for this event"
      );
    }

    assertStationSelectable(
      targetStation
    );

    const completed =
      await tx.queueEntry.update({
        where: {
          id: queueId,
        },

        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          leftQueueAt: new Date(),
        },
      });

    const nextEntry =
      await tx.queueEntry.create({
        data: {
          registrationId:
            current.registrationId,

          stationId: toStationId,

          queueNumber:
            current.queueNumber,

          status: "WAITING",

          isPriority:
            current.isPriority ?? false,

          priorityNotes:
            current.priorityNotes ?? null,
        },
      });

    await tx.queueMovement.create({
      data: {
        registrationId:
          current.registrationId,

        fromStationId:
          current.stationId,

        toStationId,

        movedBy: user.userId,

        movementReason:
          String(reason).slice(0, 100),
      },
    });

    await createAuditLog({
      userId: user.userId,

      action: "QUEUE_TRANSFERRED",

      entityName: "QueueEntry",

      entityId: nextEntry.id,

      oldValue: {
        queueEntryId: queueId,

        registrationId:
          current.registrationId,

        status: current.status,

        fromStationId:
          current.stationId,
      },

      newValue: {
        queueEntryId:
          nextEntry.id,

        status: "WAITING",

        toStationId,
      },

      context,

      client: tx,
    });

    return {
      completed,
      nextEntry,
    };
  });
};

/**
 * Complete a queue entry.
 *
 * This also marks the registration as COMPLETED because
 * this function represents completion of the final station.
 */
const completeQueueEntry = async (
  queueId,
  user,
  context = null,
  db = prisma,
  expectedEventId = null
) => {
  const entry = await loadQueueEntry(
    db,
    queueId
  );

  if (
    expectedEventId &&
    entry.registration.eventId !==
      expectedEventId
  ) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found for this event"
    );
  }

  await requireQueueStationOperation(
    db,
    entry.registration.eventId,
    entry.stationId,
    user
  );

  return db.$transaction(async (tx) => {
    const current =
      await tx.queueEntry.findUnique({
        where: {
          id: queueId,
        },
      });

    if (!current) {
      throw new AppError(
        404,
        "QUEUE_ENTRY_NOT_FOUND",
        "Queue entry not found"
      );
    }

    if (current.status !== "IN_PROGRESS") {
      throw new AppError(
        409,
        "INVALID_QUEUE_STATE",
        "Only an IN_PROGRESS queue entry can be completed",
        {
          status: current.status,
        }
      );
    }

    const updated =
      await tx.queueEntry.update({
        where: {
          id: queueId,
        },

        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          leftQueueAt: new Date(),
        },
      });

    const registration =
      await tx.eventRegistration.findUnique({
        where: {
          registrationId:
            current.registrationId,
        },
      });

    if (
      registration &&
      registration.registrationStatus !==
        "COMPLETED"
    ) {
      await tx.eventRegistration.update({
        where: {
          registrationId:
            current.registrationId,
        },

        data: {
          registrationStatus:
            "COMPLETED",
        },
      });

      await tx.registrationStatusHistory.create({
        data: {
          registrationId:
            current.registrationId,

          fromStatus:
            registration.registrationStatus,

          toStatus: "COMPLETED",

          changedById:
            user.userId,

          reason:
            "Completed the final queue station",
        },
      });
    }

    await createAuditLog({
      userId: user.userId,

      action: "QUEUE_COMPLETED",

      entityName: "QueueEntry",

      entityId: queueId,

      oldValue: {
        status: "IN_PROGRESS",
      },

      newValue: {
        status: "COMPLETED",

        registrationId:
          current.registrationId,
      },

      context,

      client: tx,
    });

    return updated;
  });
};

/**
 * Skip a queue entry.
 */
const skipQueueEntry = async (
  queueId,
  user,
  context = null,
  db = prisma,
  expectedEventId = null
) => {
  const entry = await loadQueueEntry(
    db,
    queueId
  );

  if (
    expectedEventId &&
    entry.registration.eventId !==
      expectedEventId
  ) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found for this event"
    );
  }

  await requireQueueStationOperation(
    db,
    entry.registration.eventId,
    entry.stationId,
    user
  );

  return db.$transaction(async (tx) => {
    const current =
      await tx.queueEntry.findUnique({
        where: {
          id: queueId,
        },
      });

    if (!current) {
      throw new AppError(
        404,
        "QUEUE_ENTRY_NOT_FOUND",
        "Queue entry not found"
      );
    }

    if (
      !["WAITING", "CALLED"].includes(
        current.status
      )
    ) {
      throw new AppError(
        409,
        "INVALID_QUEUE_STATE",
        "Only a WAITING or CALLED queue entry can be skipped",
        {
          status: current.status,
        }
      );
    }

    const updated =
      await tx.queueEntry.update({
        where: {
          id: queueId,
        },

        data: {
          status: "SKIPPED",
          leftQueueAt: new Date(),
        },
      });

    await createAuditLog({
      userId: user.userId,

      action: "QUEUE_SKIPPED",

      entityName: "QueueEntry",

      entityId: queueId,

      oldValue: {
        status: current.status,
      },

      newValue: {
        status: "SKIPPED",
      },

      context,

      client: tx,
    });

    return updated;
  });
};

/**
 * Remove a participant from the queue.
 */
const leaveQueue = async (
  queueId,
  user,
  context = null,
  db = prisma,
  expectedEventId = null
) => {
  const entry = await loadQueueEntry(
    db,
    queueId
  );

  if (
    expectedEventId &&
    entry.registration.eventId !==
      expectedEventId
  ) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found for this event"
    );
  }

  await requireQueueStationOperation(
    db,
    entry.registration.eventId,
    entry.stationId,
    user
  );

  return db.$transaction(async (tx) => {
    const current =
      await tx.queueEntry.findUnique({
        where: {
          id: queueId,
        },
      });

    if (!current) {
      throw new AppError(
        404,
        "QUEUE_ENTRY_NOT_FOUND",
        "Queue entry not found"
      );
    }

    if (
      ["COMPLETED", "CANCELLED"].includes(
        current.status
      )
    ) {
      throw new AppError(
        409,
        "INVALID_QUEUE_STATE",
        "A closed queue entry cannot be left again",
        {
          status: current.status,
        }
      );
    }

    const updated =
      await tx.queueEntry.update({
        where: {
          id: queueId,
        },

        data: {
          status: "CANCELLED",
          leftQueueAt: new Date(),
        },
      });

    await createAuditLog({
      userId: user.userId,

      action: "QUEUE_LEFT",

      entityName: "QueueEntry",

      entityId: queueId,

      oldValue: {
        status: current.status,
      },

      newValue: {
        status: "CANCELLED",
      },

      context,

      client: tx,
    });

    return updated;
  });
};

/**
 * Change the priority of a queue entry.
 */
const updatePriority = async (
  {
    queueId,
    isPriority,
    notes = null,
    eventId = null,
  },
  user,
  context = null,
  db = prisma
) => {
  if (
    isPriority &&
    (!notes || !String(notes).trim())
  ) {
    throw new AppError(
      422,
      "PRIORITY_NOTES_REQUIRED",
      "A reason is required when marking a queue entry as priority"
    );
  }

  const entry = await loadQueueEntry(
    db,
    queueId
  );

  if (
    eventId &&
    entry.registration.eventId !== eventId
  ) {
    throw new AppError(
      404,
      "QUEUE_ENTRY_NOT_FOUND",
      "Queue entry not found for this event"
    );
  }

  await requireQueueStationOperation(
    db,
    entry.registration.eventId,
    entry.stationId,
    user
  );

  return db.$transaction(async (tx) => {
    const current =
      await tx.queueEntry.findUnique({
        where: {
          id: queueId,
        },
      });

    if (!current) {
      throw new AppError(
        404,
        "QUEUE_ENTRY_NOT_FOUND",
        "Queue entry not found"
      );
    }

    if (
      [
        "COMPLETED",
        "CANCELLED",
        "SKIPPED",
      ].includes(current.status)
    ) {
      throw new AppError(
        409,
        "INVALID_QUEUE_STATE",
        "Priority cannot be changed on a closed queue entry",
        {
          status: current.status,
        }
      );
    }

    const updated =
      await tx.queueEntry.update({
        where: {
          id: queueId,
        },

        data: {
          isPriority,
          priorityNotes: isPriority
            ? String(notes).trim()
            : null,
        },
      });

    await createAuditLog({
      userId: user.userId,

      action:
        "QUEUE_PRIORITY_UPDATED",

      entityName: "QueueEntry",

      entityId: queueId,

      oldValue: {
        isPriority:
          current.isPriority,

        priorityNotes:
          current.priorityNotes,
      },

      newValue: {
        isPriority,

        priorityNotes:
          isPriority
            ? String(notes).trim()
            : null,
      },

      context,

      client: tx,
    });

    return updated;
  });
};

/**
 * Return workload information for every station.
 */
const getStationWorkload = async (
  eventId,
  user,
  db = prisma
) => {
  const event = await requireQueueManagement(
    db,
    eventId,
    user
  );

  const [stations, entries] =
    await Promise.all([
      db.station.findMany({
        where: {
          eventId,
          isActive: true,
        },

        orderBy: [
          {
            stationOrder: "asc",
          },

          {
            stationId: "asc",
          },
        ],
      }),

      db.queueEntry.findMany({
        where: {
          station: {
            eventId,
          },
        },

        select: {
          id: true,

          stationId: true,

          queueNumber: true,

          status: true,

          isPriority: true,

          enteredAt: true,

          completedAt: true,

          registrationId: true,
        },

        orderBy: [
          {
            enteredAt: "asc",
          },

          {
            id: "asc",
          },
        ],
      }),
    ]);

  const byStation = new Map(
    stations.map((station) => [
      station.stationId,

      {
        stationId: station.stationId,

        stationName:
          station.stationName,

        stationType:
          station.stationType,

        stationOrder:
          station.stationOrder,

        workload: {
          WAITING: 0,
          CALLED: 0,
          IN_PROGRESS: 0,
          COMPLETED: 0,
          SKIPPED: 0,
          CANCELLED: 0,
        },

        activeQueueCount: 0,

        priorityCount: 0,

        completedToday: 0,

        nextUp: null,

        avgWaitMinutes: 0,
      },
    ])
  );

  const today = new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  for (const entry of entries) {
    const bucket = byStation.get(
      entry.stationId
    );

    if (!bucket) {
      continue;
    }

    if (
      bucket.workload[entry.status] !==
      undefined
    ) {
      bucket.workload[entry.status] += 1;
    }

    if (
      ACTIVE_QUEUE_STATUSES.includes(
        entry.status
      )
    ) {
      bucket.activeQueueCount += 1;

      if (entry.isPriority) {
        bucket.priorityCount += 1;
      }
    }

    if (
      entry.status === "COMPLETED" &&
      entry.completedAt &&
      entry.completedAt >= today
    ) {
      bucket.completedToday += 1;
    }
  }

  for (const bucket of byStation.values()) {
    const stationEntries =
      entries.filter(
        (entry) =>
          entry.stationId ===
          bucket.stationId
      );

    const next =
      waitingOrder(stationEntries)[0];

    if (next) {
      bucket.nextUp = {
        queueId: next.id,

        queueNumber:
          next.queueNumber,

        registrationId:
          next.registrationId,

        isPriority:
          next.isPriority,
      };
    }

    if (bucket.activeQueueCount > 0) {
      const activeEntries =
        stationEntries.filter((entry) =>
          ACTIVE_QUEUE_STATUSES.includes(
            entry.status
          )
        );

      const waitSum =
        activeEntries.reduce(
          (sum, entry) => {
            return (
              sum +
              Math.max(
                0,
                Date.now() -
                  new Date(
                    entry.enteredAt
                  ).getTime()
              )
            );
          },
          0
        );

      bucket.avgWaitMinutes =
        Math.round(
          waitSum /
            bucket.activeQueueCount /
            60000
        );
    }
  }

  return {
    event,

    stations: [
      ...byStation.values(),
    ],
  };
};

module.exports = {
  joinQueue,
  listRegistrationStations,
  createQueueHandoff,
  getEventQueueStatus,
  getParticipantQueueStatus,
  callQueueEntry,
  startQueueEntry,
  advanceQueueEntry,
  completeQueueEntry,
  skipQueueEntry,
  leaveQueue,
  updatePriority,
  getStationWorkload,
};
