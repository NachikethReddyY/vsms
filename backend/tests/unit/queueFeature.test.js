const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const queueService = require('../../services/screening/queueService');

const uuid = () => crypto.randomUUID();
const eventId = uuid();
const stationId = uuid();
const targetStationId = uuid();
const registrationId = uuid();
const queueId = uuid();

const event = { eventId, name: 'Jurong Live', status: 'IN_PROGRESS', venue: 'Jurong Regional Library' };
const station = { stationId, eventId, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY', isActive: true, stationTemplate: { defaultCapacity: 4 } };
const targetStation = { stationId: targetStationId, eventId, stationName: 'Refraction', stationType: 'REFRACTION', isActive: true };
const registration = {
  registrationId,
  eventId,
  queueNumber: 7,
  registrationStatus: 'CHECKED_IN',
  participantDisplayName: 'Daniel Tan',
};
const queueEntry = {
  id: queueId,
  registrationId,
  stationId,
  queueNumber: 7,
  status: 'WAITING',
  enteredAt: new Date(),
  calledAt: null,
  startedAt: null,
  leftQueueAt: null,
  completedAt: null,
  registration: { eventId, participantDisplayName: 'Daniel Tan' },
  station: { stationId, stationName: 'Visual Acuity' },
};

const context = { requestId: uuid(), deviceId: null, ipAddress: '203.0.113.7', deviceName: 'Queue test station' };

const audits = [];
const captureAudit = async ({ data }) => {
  audits.push(data);
  return { ...data, id: uuid() };
};

const baseDb = (overrides = {}) => ({
  event: {
    findUnique: async () => event,
    ...(overrides.event || {}),
  },
  station: {
    findFirst: async ({ where }) => {
      if (where.stationId === targetStationId) return targetStation;
      if (where.stationId === stationId) return station;
      return null;
    },
    findMany: async () => [],
    ...(overrides.station || {}),
  },
  staffAssignment: {
    findFirst: async ({ where }) => (
      where.assignmentRole === 'SCREENER' && where.stationId && where.stationId !== stationId
        ? null
        : { id: uuid(), stationId: where.stationId || null }
    ),
    ...(overrides.staffAssignment || {}),
  },
  eventMembership: {
    findFirst: async ({ where }) => {
      const user = [operationalUser, screenerUser, registrationUser, supportUser, staffUser].find(({ userId }) => userId === where.userId);
      const role = ['EVENT_MANAGER', 'REGISTRATION', 'SCREENER', 'SUPPORT'].find((candidate) => user?.roles.includes(candidate));
      return role ? { id: uuid(), eventId, userId: user.userId, status: 'ACTIVE', roles: [{ role }], user } : null;
    },
  },
  queueEntry: {
    findUnique: async () => queueEntry,
    findMany: async () => [],
    ...(overrides.queueEntry || {}),
  },
  $transaction: async (callback) => callback(baseTransaction()),
  ...(overrides.root || {}),
});

const baseTransaction = (overrides = {}) => ({
  $executeRaw: async () => undefined,
  station: {
    findFirst: async ({ where }) => {
      if (where.stationId === targetStationId) return targetStation;
      if (where.stationId === stationId) return station;
      return null;
    },
    ...(overrides.station || {}),
  },
  eventRegistration: {
    findFirst: async () => registration,
    findUnique: async () => registration,
    aggregate: async () => ({ _max: { queueNumber: 9 } }),
    update: async ({ data }) => ({ ...registration, ...data }),
    ...(overrides.eventRegistration || {}),
  },
  queueEntry: {
    findFirst: async () => null,
    findUnique: async () => queueEntry,
    create: async ({ data }) => ({ id: queueId, ...data }),
    update: async ({ data }) => ({ ...queueEntry, ...data }),
    ...(overrides.queueEntry || {}),
  },
  queueMovement: {
    create: async ({ data }) => ({ id: uuid(), ...data }),
    ...(overrides.queueMovement || {}),
  },
  registrationStatusHistory: {
    create: async ({ data }) => ({ id: uuid(), ...data }),
    ...(overrides.registrationStatusHistory || {}),
  },
  auditLog: {
    create: captureAudit,
    ...(overrides.auditLog || {}),
  },
});

const accountState = { status: 'ACTIVE', approvalState: 'APPROVED', accessState: 'ENABLED' };
const operationalUser = { userId: uuid(), roles: ['EVENT_MANAGER'], ...accountState };
const screenerUser = { userId: uuid(), roles: ['SCREENER'], ...accountState };
const registrationUser = { userId: uuid(), roles: ['REGISTRATION'], ...accountState };
const supportUser = { userId: uuid(), roles: ['SUPPORT'], ...accountState };
const staffUser = { userId: uuid(), roles: ['STAFF'], ...accountState };

test('queue join creates a WAITING entry and emits QUEUE_JOINED audit', async () => {
  audits.length = 0;
  const db = baseDb();
  const result = await queueService.joinQueue(
    { eventId, stationId, registrationId },
    operationalUser,
    context,
    db,
  );

  assert.equal(result.created, true);
  assert.equal(result.queueEntry.status, 'WAITING');
  assert.equal(result.queueEntry.queueNumber, 7);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'QUEUE_JOINED');
  assert.equal(audits[0].entityName, 'QueueEntry');
  assert.equal(audits[0].userId, operationalUser.userId);
  assert.equal(audits[0].requestId, context.requestId);
  assert.equal(audits[0].newValue.registrationId, registrationId);
});

test('queue join persists a newly allocated queue number on the registration', async () => {
  let updatedQueueNumber = null;
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        eventRegistration: {
          findFirst: async () => ({ ...registration, queueNumber: null }),
          update: async ({ data }) => {
            updatedQueueNumber = data.queueNumber;
            return { ...registration, ...data };
          },
        },
      })),
    },
  });

  const result = await queueService.joinQueue(
    { eventId, stationId, registrationId },
    operationalUser,
    context,
    db,
  );

  assert.equal(result.queueEntry.queueNumber, 10);
  assert.equal(updatedQueueNumber, 10);
});

test('queue join rejects a paused station', async () => {
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        station: { findFirst: async () => ({ ...station, operationalStatus: 'PAUSED' }) },
      })),
    },
  });

  await assert.rejects(
    queueService.joinQueue({ eventId, stationId, registrationId }, operationalUser, context, db),
    (error) => error.code === 'STATION_UNAVAILABLE',
  );
});

test('queue join is idempotent when the participant is already active at the same station', async () => {
  audits.length = 0;
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findFirst: async () => queueEntry,
        },
      })),
    },
  });
  const result = await queueService.joinQueue(
    { eventId, stationId, registrationId },
    operationalUser,
    context,
    db,
  );

  assert.equal(result.created, false);
  assert.equal(result.queueEntry.id, queueId);
  assert.equal(audits.length, 0);
});

test('registration station list exposes derived availability and queue counts', async () => {
  const pausedStation = { ...targetStation, operationalStatus: 'PAUSED' };
  const db = baseDb({
    station: { findMany: async () => [station, pausedStation] },
    queueEntry: { findMany: async () => [{ stationId }] },
  });

  const result = await queueService.listRegistrationStations(eventId, operationalUser, db);

  assert.equal(result.stations[0].status, 'BUSY');
  assert.equal(result.stations[0].activeQueueCount, 1);
  assert.equal(result.stations[0].capacity, 4);
  assert.equal(result.stations[0].occupancyPercent, 25);
  assert.equal(result.stations[0].selectable, true);
  assert.equal(result.stations[1].status, 'PAUSED');
  assert.equal(result.stations[1].selectable, false);
});

test('registration station list preserves an explicit busy status without a queue', async () => {
  const db = baseDb({
    station: { findMany: async () => [{ ...station, operationalStatus: 'BUSY' }] },
    queueEntry: { findMany: async () => [] },
  });

  const result = await queueService.listRegistrationStations(eventId, operationalUser, db);

  assert.equal(result.stations[0].status, 'BUSY');
  assert.equal(result.stations[0].selectable, true);
});

test('queue handoff allocates a queue number, creates the entry, and audits the assignment', async () => {
  audits.length = 0;
  const registrationWithoutQueue = {
    ...registration,
    queueNumber: null,
    participant: { id: uuid(), participantReference: 'P-00001', firstName: 'Daniel', lastName: 'Tan' },
    event: { eventId, name: event.name },
  };
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        eventRegistration: {
          findFirst: async () => registrationWithoutQueue,
          update: async ({ data }) => ({ ...registrationWithoutQueue, ...data }),
        },
      })),
    },
  });

  const result = await queueService.createQueueHandoff(
    { eventId, stationId, registrationId },
    operationalUser,
    context,
    db,
  );

  assert.equal(result.created, true);
  assert.equal(result.queueNumber, 10);
  assert.equal(result.nextStation, station.stationName);
  assert.equal(result.assignedStation.status, 'BUSY');
  assert.equal(audits.at(-1).action, 'REGISTRATION_QUEUE_HANDOFF_CREATED');
});

test('queue handoff rejects a paused station before creating a queue entry', async () => {
  const pausedStation = { ...station, operationalStatus: 'PAUSED' };
  const registrationWithDetails = {
    ...registration,
    participant: { id: uuid(), participantReference: 'P-00002', firstName: 'Aisha', lastName: 'Lim' },
    event: { eventId, name: event.name },
  };
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        station: { findFirst: async () => pausedStation },
        eventRegistration: { findFirst: async () => registrationWithDetails },
      })),
    },
  });

  await assert.rejects(
    queueService.createQueueHandoff({ eventId, stationId, registrationId }, operationalUser, context, db),
    /no longer available/,
  );
});

test('queue handoff limits a screener to the station in their current duty', async () => {
  await assert.rejects(
    queueService.createQueueHandoff(
      { eventId, stationId: targetStationId, registrationId },
      screenerUser,
      context,
      baseDb(),
    ),
    (error) => error.code === 'CURRENT_DUTY_REQUIRED' && error.status === 403,
  );
});

test('queue join rejects a participant already active at another station', async () => {
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findFirst: async () => ({ ...queueEntry, stationId: targetStationId }),
        },
      })),
    },
  });

  await assert.rejects(
    queueService.joinQueue({ eventId, stationId, registrationId }, operationalUser, context, db),
    (error) => error.code === 'ALREADY_IN_QUEUE',
  );
});

test('queue join rejects non-operational roles', async () => {
  const db = baseDb();
  await assert.rejects(
    queueService.joinQueue({ eventId, stationId, registrationId }, staffUser, context, db),
    (error) => error.code === 'EVENT_ROLE_REQUIRED' && error.status === 403,
  );
});

test('queue join limits a screener to the station in their current duty', async () => {
  const db = baseDb();
  await assert.rejects(
    queueService.joinQueue({ eventId, stationId: targetStationId, registrationId }, screenerUser, context, db),
    (error) => error.code === 'CURRENT_DUTY_REQUIRED' && error.status === 403,
  );
});

test('registration and support duties may join any station in their event', async () => {
  for (const user of [registrationUser, supportUser]) {
    const result = await queueService.joinQueue(
      { eventId, stationId: targetStationId, registrationId },
      user,
      context,
      baseDb(),
    );
    assert.equal(result.created, true);
    assert.equal(result.queueEntry.stationId, targetStationId);
  }
});

test('callQueueEntry transitions WAITING to CALLED and emits QUEUE_CALLED audit', async () => {
  audits.length = 0;
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findUnique: async () => queueEntry,
          update: async ({ data }) => ({ ...queueEntry, ...data }),
        },
      })),
    },
  });

  const result = await queueService.callQueueEntry(queueId, screenerUser, context, db);

  assert.equal(result.status, 'CALLED');
  assert.ok(result.calledAt);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'QUEUE_CALLED');
  assert.deepEqual(audits[0].oldValue, { status: 'WAITING' });
  assert.deepEqual(audits[0].newValue, { status: 'CALLED' });
});

test('callQueueEntry rejects a non-WAITING entry', async () => {
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findUnique: async () => ({ ...queueEntry, status: 'IN_PROGRESS' }),
        },
      })),
    },
  });

  await assert.rejects(
    queueService.callQueueEntry(queueId, screenerUser, context, db),
    (error) => error.code === 'INVALID_QUEUE_STATE',
  );
});

test('advanceQueueEntry transfers to the target station, closes the old entry, and records movement', async () => {
  audits.length = 0;
  const movements = [];
  let findUniqueCalls = 0;
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findUnique: async () => {
            findUniqueCalls += 1;
            return findUniqueCalls === 1
              ? { ...queueEntry, status: 'IN_PROGRESS' }
              : { ...queueEntry, status: 'COMPLETED', completedAt: new Date(), leftQueueAt: new Date() };
          },
          update: async ({ data }) => ({ ...queueEntry, ...data }),
          create: async ({ data }) => ({ id: uuid(), ...queueEntry, ...data }),
        },
        queueMovement: {
          create: async ({ data }) => {
            movements.push(data);
            return { id: uuid(), ...data };
          },
        },
      })),
    },
  });

  const result = await queueService.advanceQueueEntry(
    { queueId, toStationId: targetStationId, reason: 'Proceed to refraction' },
    operationalUser,
    context,
    db,
  );

  assert.equal(result.completed.status, 'COMPLETED');
  assert.ok(result.completed.completedAt);
  assert.ok(result.completed.leftQueueAt);
  assert.equal(result.nextEntry.stationId, targetStationId);
  assert.equal(result.nextEntry.status, 'WAITING');
  assert.equal(result.nextEntry.queueNumber, 7);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].fromStationId, stationId);
  assert.equal(movements[0].toStationId, targetStationId);
  assert.equal(movements[0].movedBy, operationalUser.userId);
  assert.equal(movements[0].movementReason, 'Proceed to refraction');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'QUEUE_TRANSFERRED');
});

test('advanceQueueEntry rejects a transfer to a station outside the event', async () => {
  const db = baseDb({
    station: {
      findFirst: async () => null,
    },
  });

  await assert.rejects(
    queueService.advanceQueueEntry({ queueId, toStationId: targetStationId }, operationalUser, context, db),
    (error) => error.code === 'STATION_NOT_FOUND',
  );
});

test('completeQueueEntry marks the entry COMPLETED, completes the registration, and emits QUEUE_COMPLETED audit', async () => {
  audits.length = 0;
  const statusChanges = [];
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        registrationStatusHistory: {
          create: async ({ data }) => {
            statusChanges.push(data);
            return { id: uuid(), ...data };
          },
        },
        eventRegistration: {
          findUnique: async () => ({ ...registration, registrationStatus: 'CHECKED_IN' }),
          update: async ({ data }) => ({ ...registration, ...data }),
        },
        queueEntry: {
          findUnique: async () => ({ ...queueEntry, status: 'IN_PROGRESS' }),
          update: async ({ data }) => ({ ...queueEntry, ...data }),
        },
      })),
    },
  });

  const result = await queueService.completeQueueEntry(queueId, screenerUser, context, db);

  assert.equal(result.status, 'COMPLETED');
  assert.ok(result.completedAt);
  assert.equal(statusChanges.length, 1);
  assert.equal(statusChanges[0].fromStatus, 'CHECKED_IN');
  assert.equal(statusChanges[0].toStatus, 'COMPLETED');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'QUEUE_COMPLETED');
});

test('skipQueueEntry marks WAITING or CALLED entries as SKIPPED', async () => {
  audits.length = 0;
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findUnique: async () => ({ ...queueEntry, status: 'CALLED' }),
          update: async ({ data }) => ({ ...queueEntry, ...data }),
        },
      })),
    },
  });

  const result = await queueService.skipQueueEntry(queueId, screenerUser, context, db);

  assert.equal(result.status, 'SKIPPED');
  assert.ok(result.leftQueueAt);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'QUEUE_SKIPPED');
});

test('leaveQueue cancels an active entry and emits QUEUE_LEFT audit', async () => {
  audits.length = 0;
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findUnique: async () => ({ ...queueEntry, status: 'WAITING' }),
          update: async ({ data }) => ({ ...queueEntry, ...data }),
        },
      })),
    },
  });

  const result = await queueService.leaveQueue(queueId, screenerUser, context, db);

  assert.equal(result.status, 'CANCELLED');
  assert.ok(result.leftQueueAt);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'QUEUE_LEFT');
});

test('getEventQueueStatus reports per-station workload and next-up participant', async () => {
  const db = baseDb({
    root: {
      station: {
        findMany: async () => [station, targetStation],
      },
      queueEntry: {
        findMany: async () => [
          { ...queueEntry, id: uuid(), stationId, queueNumber: 7, status: 'WAITING', registration: { participantDisplayName: 'Daniel Tan' } },
          { ...queueEntry, id: uuid(), stationId, queueNumber: 8, status: 'CALLED', registration: { participantDisplayName: 'Aisha Rahman' } },
          { ...queueEntry, id: uuid(), stationId: targetStationId, queueNumber: 5, status: 'IN_PROGRESS', registration: { participantDisplayName: 'Priya Nair' } },
        ],
      },
    },
  });

  const result = await queueService.getEventQueueStatus(eventId, operationalUser, db);

  assert.equal(result.event.eventId, eventId);
  assert.equal(result.stations.length, 2);
  const va = result.stations.find((s) => s.stationId === stationId);
  assert.equal(va.workload.WAITING, 1);
  assert.equal(va.workload.CALLED, 1);
  assert.equal(va.workload.IN_PROGRESS, 0);
  assert.equal(va.nextUp.queueNumber, 7);
  assert.equal(va.nextUp.participantDisplayName, 'Daniel Tan');
});

test('getParticipantQueueStatus returns active entry and movement history', async () => {
  const db = baseDb({
    root: {
      eventRegistration: {
        findFirst: async () => registration,
      },
      queueEntry: {
        findMany: async () => [
          { ...queueEntry, status: 'CALLED', station: { stationId, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY' }, screeningResults: [] },
        ],
      },
    },
  });

  const result = await queueService.getParticipantQueueStatus(eventId, registrationId, operationalUser, db);

  assert.equal(result.registrationId, registrationId);
  assert.equal(result.queueNumber, 7);
  assert.equal(result.activeEntry.status, 'CALLED');
  assert.equal(result.history.length, 1);
});

test('station operations require an active screener assignment', async () => {
  const db = baseDb({
    staffAssignment: {
      findFirst: async () => null,
    },
  });

  await assert.rejects(
    queueService.callQueueEntry(queueId, screenerUser, context, db),
    (error) => error.code === 'CURRENT_DUTY_REQUIRED' && error.status === 403,
  );
});

test('event managers may operate queues without a clinical duty', async () => {
  const db = baseDb({
    staffAssignment: {
      findFirst: async () => null,
    },
  });

  const called = await queueService.callQueueEntry(queueId, operationalUser, context, db);
  assert.equal(called.status, 'CALLED');
});

test('updatePriority marks an active entry urgent and emits QUEUE_PRIORITY_UPDATED audit', async () => {
  audits.length = 0;
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findUnique: async () => ({ ...queueEntry, isPriority: false, priorityNotes: null }),
          update: async ({ data }) => ({ ...queueEntry, ...data }),
        },
      })),
    },
  });

  const result = await queueService.updatePriority(
    { queueId, isPriority: true, notes: 'Urgent medical review required' },
    operationalUser,
    context,
    db,
  );

  assert.equal(result.isPriority, true);
  assert.equal(result.priorityNotes, 'Urgent medical review required');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'QUEUE_PRIORITY_UPDATED');
  assert.deepEqual(audits[0].oldValue, { isPriority: false, priorityNotes: null });
  assert.deepEqual(audits[0].newValue, { isPriority: true, priorityNotes: 'Urgent medical review required' });
});

test('updatePriority rejects changing priority on a closed entry', async () => {
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueEntry: {
          findUnique: async () => ({ ...queueEntry, status: 'COMPLETED' }),
        },
      })),
    },
  });

  await assert.rejects(
    queueService.updatePriority({ queueId, isPriority: true, notes: 'Reason for elevation' }, operationalUser, context, db),
    (error) => error.code === 'INVALID_QUEUE_STATE',
  );
});

test('getStationWorkload reports active load, priority count, and average wait', async () => {
  const now = Date.now();
  const db = baseDb({
    root: {
      station: {
        findMany: async () => [station, targetStation],
      },
      queueEntry: {
        findMany: async () => [
          { ...queueEntry, id: uuid(), stationId, queueNumber: 7, status: 'WAITING', isPriority: false, enteredAt: new Date(now - 2 * 60000), completedAt: null, registrationId },
          { ...queueEntry, id: uuid(), stationId, queueNumber: 8, status: 'CALLED', isPriority: true, enteredAt: new Date(now - 6 * 60000), completedAt: null, registrationId },
          { ...queueEntry, id: uuid(), stationId: targetStationId, queueNumber: 5, status: 'IN_PROGRESS', isPriority: false, enteredAt: new Date(now - 60000), completedAt: null, registrationId },
          { ...queueEntry, id: uuid(), stationId: targetStationId, queueNumber: 4, status: 'COMPLETED', isPriority: false, enteredAt: new Date(now - 60 * 60000), completedAt: new Date(), registrationId },
        ],
      },
    },
  });

  const result = await queueService.getStationWorkload(eventId, operationalUser, db);

  assert.equal(result.event.eventId, eventId);
  assert.equal(result.stations.length, 2);
  const va = result.stations.find((s) => s.stationId === stationId);
  assert.equal(va.workload.WAITING, 1);
  assert.equal(va.workload.CALLED, 1);
  assert.equal(va.activeQueueCount, 2);
  assert.equal(va.priorityCount, 1);
  assert.equal(va.nextUp.queueNumber, 7);
  assert.equal(va.completedToday, 0);
  assert.ok(va.avgWaitMinutes >= 4, `expected avg wait >= 4, got ${va.avgWaitMinutes}`);

  const refraction = result.stations.find((s) => s.stationId === targetStationId);
  assert.equal(refraction.workload.IN_PROGRESS, 1);
  assert.equal(refraction.activeQueueCount, 1);
  assert.equal(refraction.completedToday, 1);
});

test('getEventQueueStatus pulls a priority waiting entry to next-up', async () => {
  const db = baseDb({
    root: {
      station: {
        findMany: async () => [station],
      },
      queueEntry: {
        findMany: async () => [
          { ...queueEntry, id: uuid(), stationId, queueNumber: 9, status: 'WAITING', isPriority: true, registration: { participantDisplayName: 'Urgent Case' } },
          { ...queueEntry, id: uuid(), stationId, queueNumber: 7, status: 'WAITING', isPriority: false, registration: { participantDisplayName: 'Daniel Tan' } },
        ],
      },
    },
  });

  const result = await queueService.getEventQueueStatus(eventId, operationalUser, db);

  const va = result.stations.find((s) => s.stationId === stationId);
  assert.equal(va.nextUp.queueNumber, 9);
  assert.equal(va.nextUp.isPriority, true);
  assert.equal(va.nextUp.participantDisplayName, 'Urgent Case');
});

test('getEventQueueStatus returns ordered entries with priority metadata and participant references', async () => {
  const db = baseDb({
    root: {
      station: {
        findMany: async () => [station],
      },
      queueEntry: {
        findMany: async () => [
          { ...queueEntry, id: uuid(), stationId, queueNumber: 3, status: 'WAITING', isPriority: false, priorityNotes: null, registration: { participantDisplayName: 'Tan Mei Ling', participant: { participantReference: 'P-2026-0003' } }, station: { stationName: station.stationName, stationType: station.stationType } },
          { ...queueEntry, id: uuid(), stationId, queueNumber: 1, status: 'WAITING', isPriority: true, priorityNotes: 'Needs an interpreter', registration: { participantDisplayName: 'Aisha Binte Rahman', participant: { participantReference: 'P-2026-0001' } }, station: { stationName: station.stationName, stationType: station.stationType } },
          { ...queueEntry, id: uuid(), stationId, queueNumber: 2, status: 'CALLED', isPriority: false, priorityNotes: null, registration: { participantDisplayName: 'Marcus Goh Wei Liang', participant: { participantReference: 'P-2026-0002' } }, station: { stationName: station.stationName, stationType: station.stationType } },
        ],
      },
    },
  });

  const result = await queueService.getEventQueueStatus(eventId, operationalUser, db);

  const va = result.stations.find((s) => s.stationId === stationId);
  assert.equal(va.nextUp.queueNumber, 1);
  assert.equal(va.nextUp.isPriority, true);
  assert.equal(va.nextUp.participantDisplayName, 'Aisha Binte Rahman');

  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map((entry) => entry.queueNumber), [1, 2, 3]);
  const aisha = result.entries.find((entry) => entry.queueNumber === 1);
  assert.equal(aisha.participantReference, 'P-2026-0001');
  assert.equal(aisha.isPriority, true);
  assert.equal(aisha.priorityNotes, 'Needs an interpreter');
  assert.equal(aisha.stationName, station.stationName);
  assert.equal(aisha.stationType, station.stationType);
});

test('getStationWorkload promotes a priority waiting entry to next-up', async () => {
  const now = Date.now();
  const db = baseDb({
    root: {
      station: {
        findMany: async () => [station],
      },
      queueEntry: {
        findMany: async () => [
          { ...queueEntry, id: uuid(), stationId, queueNumber: 8, status: 'WAITING', isPriority: false, enteredAt: new Date(now - 60000), completedAt: null, registrationId },
          { ...queueEntry, id: uuid(), stationId, queueNumber: 9, status: 'WAITING', isPriority: true, enteredAt: new Date(now - 120000), completedAt: null, registrationId },
        ],
      },
    },
  });

  const result = await queueService.getStationWorkload(eventId, operationalUser, db);

  const va = result.stations.find((s) => s.stationId === stationId);
  assert.equal(va.nextUp.queueNumber, 9);
  assert.equal(va.nextUp.isPriority, true);
  assert.equal(va.priorityCount, 1);
});

test('updatePriority requires a reason when elevating an entry to priority', async () => {
  const db = baseDb();
  await assert.rejects(
    queueService.updatePriority({ queueId, isPriority: true }, operationalUser, context, db),
    (error) => error.code === 'PRIORITY_NOTES_REQUIRED' && error.status === 422,
  );
});
