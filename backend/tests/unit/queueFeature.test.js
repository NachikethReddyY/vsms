const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const queueService = require('../../services/queueService');

const uuid = () => crypto.randomUUID();
const eventId = uuid();
const stationId = uuid();
const targetStationId = uuid();
const registrationId = uuid();
const queueId = uuid();

const event = { eventId, name: 'Jurong Live', status: 'IN_PROGRESS', venue: 'Jurong Regional Library' };
const station = { stationId, eventId, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY', isActive: true };
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
    ...(overrides.station || {}),
  },
  staffAssignment: {
    findFirst: async () => ({ id: uuid() }),
    ...(overrides.staffAssignment || {}),
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

const operationalUser = { userId: uuid(), roles: ['EVENT_MANAGER'] };
const screenerUser = { userId: uuid(), roles: ['SCREENER'] };
const staffUser = { userId: uuid(), roles: ['STAFF'] };

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
    (error) => error.code === 'QUEUE_ROLE_REQUIRED' && error.status === 403,
  );
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
  const createdEntries = [];
  const db = baseDb({
    root: {
      $transaction: async (callback) => callback(baseTransaction({
        queueMovement: {
          create: async ({ data }) => {
            movements.push(data);
            return { id: uuid(), ...data };
          },
        },
        queueEntry: {
          findUnique: async () => queueEntry,
          update: async ({ data }) => ({ ...queueEntry, ...data }),
          create: async ({ data }) => {
            const created = { id: uuid(), ...data };
            createdEntries.push(created);
            return created;
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
  assert.equal(createdEntries.length, 1);
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
    (error) => error.code === 'FORBIDDEN' && error.status === 403,
  );
});

test('event managers and administrators bypass the screener assignment check', async () => {
  const db = baseDb({
    staffAssignment: {
      findFirst: async () => null,
    },
  });

  const called = await queueService.callQueueEntry(queueId, operationalUser, context, db);
  assert.equal(called.status, 'CALLED');
});
