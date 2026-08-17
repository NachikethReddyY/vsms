import 'fake-indexeddb/auto';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getDeviceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  newIdempotencyHeaders: () => ({ 'Idempotency-Key': '77777777-7777-4777-8777-777777777777' }),
}));

import apiClient from '../../utils/apiClient';
import type { EventQueueStatus, RegistrationRouteState } from '../../features/queue/queueApi';
import {
  clearOfflineData,
  downloadOfflineEvent,
  getOfflineEvent,
  getOfflineParticipantRoute,
  getOfflineQueueStatus,
  getOfflineSyncStatus,
  queueOfflineQueueAction,
  queueOfflineRouteOverride,
  queueOfflineStationAvailability,
  syncOfflineEvent,
} from '../../features/screening/offlineSync';

const ownerId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const registrationId = '33333333-3333-4333-8333-333333333333';
const currentStationId = '44444444-4444-4444-8444-444444444444';
const nextStationId = '55555555-5555-4555-8555-555555555555';
const queueId = '66666666-6666-4666-8666-666666666666';
const canonicalQueueId = '88888888-8888-4888-8888-888888888888';
const expiresAt = '2099-08-17T10:00:00.000Z';
const issuedAt = '2026-08-17T08:00:00.000Z';
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const leaseKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const exportedPublicKey = leaseKeys.publicKey.export({ format: 'jwk' });
const publicKey = { kty: 'EC', crv: 'P-256', x: exportedPublicKey.x, y: exportedPublicKey.y };

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalJson(object[key])]));
  }
  return value;
}

const route: RegistrationRouteState = {
  status: 'READY',
  routeVersion: 3,
  steps: [
    {
      stationId: currentStationId,
      stationName: 'Visual acuity',
      stationType: 'VISUAL_ACUITY',
      position: 1,
      state: 'CURRENT',
    },
    {
      stationId: nextStationId,
      stationName: 'Refraction',
      stationType: 'REFRACTION',
      position: 2,
      state: 'UPCOMING',
    },
  ],
  currentStation: {
    stationId: currentStationId,
    stationName: 'Visual acuity',
    stationType: 'VISUAL_ACUITY',
    position: 1,
    state: 'CURRENT',
  },
  queue: { queueEntryId: queueId, stationId: currentStationId, queueNumber: 12, status: 'WAITING' },
};

const queue: EventQueueStatus = {
  event: { eventId, name: 'Offline event', status: 'IN_PROGRESS', venue: null },
  stations: [
    {
      stationId: currentStationId,
      stationName: 'Visual acuity',
      stationType: 'VISUAL_ACUITY',
      stationOrder: 1,
      workload: { WAITING: 1, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
      nextUp: { queueId, queueNumber: 12, registrationId, participantDisplayName: 'Offline participant', isPriority: false },
    },
    {
      stationId: nextStationId,
      stationName: 'Refraction',
      stationType: 'REFRACTION',
      stationOrder: 2,
      workload: { WAITING: 0, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
      nextUp: null,
    },
  ],
  totals: { WAITING: 1, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
  entries: [{
    id: queueId,
    queueNumber: 12,
    status: 'WAITING',
    isPriority: false,
    registrationId,
    participantDisplayName: 'Offline participant',
    stationId: currentStationId,
    stationName: 'Visual acuity',
    stationType: 'VISUAL_ACUITY',
  }],
};

function packResponse(routeState: RegistrationRouteState = route, event: Record<string, unknown> = { eventId, name: 'Offline event' }) {
  const capabilities = { screening: false, registration: false, queue: true, review: false, routeOverride: true, stationAvailability: true };
  const data = {
    schemaVersion: 1 as const,
    packId: 'a'.repeat(43),
    generatedAt: issuedAt,
    expiresAt,
    event,
    roles: ['EVENT_MANAGER'],
    capabilities,
    screening: null,
    registration: null,
    queue,
    routes: [{ registrationId, route: routeState }],
    review: null,
  };
  const payload = {
    schemaVersion: 1 as const,
    packId: data.packId,
    actorId: ownerId,
    eventId,
    deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    issuedAt,
    expiresAt,
    roles: data.roles,
    capabilities,
    contentDigest: createHash('sha256').update(JSON.stringify(canonicalJson(data))).digest('base64url'),
  };
  return {
    data: {
      ...data,
      lease: {
        algorithm: 'ES256' as const,
        keyId: createHash('sha256').update(JSON.stringify(publicKey)).digest('base64url'),
        publicKey,
        payload,
        signature: signBytes('sha256', Buffer.from(JSON.stringify(payload)), {
          key: leaseKeys.privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url'),
      },
    },
  };
}

function canonicalRoute(): RegistrationRouteState {
  return {
    status: 'READY',
    routeVersion: 4,
    steps: [
      { ...route.steps[0], state: 'COMPLETED' },
      { ...route.steps[1], state: 'CURRENT' },
    ],
    currentStation: { ...route.steps[1], state: 'CURRENT' },
    queue: { queueEntryId: canonicalQueueId, stationId: nextStationId, queueNumber: 12, status: 'WAITING' },
  };
}

async function rawRecords(): Promise<Array<{ kind: string; ciphertext: ArrayBuffer }>> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vsms-screening-offline', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('records', 'readonly').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

beforeEach(async () => {
  get.mockReset();
  post.mockReset();
  vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);
  await clearOfflineData();
});

afterEach(() => vi.restoreAllMocks());

describe('offline route override sync', () => {
  it('optimistically toggles manager station availability, applies its receipt, and retains conflicts', async () => {
    const station = { eventStationId: currentStationId, isAvailable: true };
    const event = { eventId, name: 'Offline event', timezone: 'Asia/Singapore', eventDays: [], eventStations: [station], shifts: [], version: 7 };
    get.mockResolvedValueOnce(packResponse(route, event));
    await downloadOfflineEvent(ownerId, eventId);
    await expect(queueOfflineStationAvailability(ownerId, eventId, currentStationId, false, 7)).resolves.toMatchObject({
      version: 8, eventStations: [{ eventStationId: currentStationId, isAvailable: false }],
    });
    post.mockImplementationOnce(async (_url, body) => ({ data: {
      clientBatchId: (body as { clientBatchId: string }).clientBatchId,
      serverTime: issuedAt,
      actions: [{
        clientActionId: (body as { actions: Array<{ clientActionId: string }> }).actions[0].clientActionId,
        status: 'APPLIED', retryCount: 0,
        result: { eventStationId: currentStationId, isAvailable: false, eventVersion: 8 },
      }],
    } }));
    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 1, pending: 0, conflicts: 0 });
    await expect(getOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ version: 8, eventStations: [{ isAvailable: false }] });

    await queueOfflineStationAvailability(ownerId, eventId, currentStationId, true, 8);
    post.mockImplementationOnce(async (_url, body) => ({ data: {
      clientBatchId: (body as { clientBatchId: string }).clientBatchId,
      serverTime: issuedAt,
      actions: [{
        clientActionId: (body as { actions: Array<{ clientActionId: string }> }).actions[0].clientActionId,
        status: 'CONFLICT', retryCount: 0, errorCode: 'STALE_EVENT_VERSION',
      }],
    } }));
    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ pending: 0, conflicts: 1 });
  });

  it('requires an earlier queue change to sync before editing the same participant route', async () => {
    get.mockResolvedValueOnce(packResponse());
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineQueueAction(ownerId, eventId, queueId, 'CALL');

    await expect(queueOfflineRouteOverride(ownerId, eventId, registrationId, {
      stationIds: [nextStationId, currentStationId],
      reasonCode: 'QUEUE_BALANCING',
      expectedVersion: 3,
      skipActive: true,
    })).rejects.toThrow(/queue change.*before editing the route/i);
  });

  it('stores an encrypted optimistic route, blocks its provisional queue, and atomically applies the canonical receipt', async () => {
    get.mockResolvedValueOnce(packResponse());
    await downloadOfflineEvent(ownerId, eventId);

    await expect(queueOfflineRouteOverride(ownerId, eventId, registrationId, {
      stationIds: [nextStationId, currentStationId],
      reasonCode: 'QUEUE_BALANCING',
      expectedVersion: 3,
      skipActive: true,
    })).resolves.toMatchObject({
      routeVersion: 4,
      currentStation: { stationId: nextStationId, state: 'CURRENT' },
      queue: { stationId: nextStationId, status: 'WAITING' },
    });

    const optimisticQueue = await getOfflineQueueStatus(ownerId, eventId);
    const provisional = optimisticQueue?.entries.find(({ id }) => id.startsWith('local-route:'));
    expect(optimisticQueue).toMatchObject({ totals: { WAITING: 1, SKIPPED: 1 } });
    expect(optimisticQueue?.entries.find(({ id }) => id === queueId)).toMatchObject({ status: 'SKIPPED' });
    expect(provisional).toMatchObject({ registrationId, stationId: nextStationId, status: 'WAITING' });
    await expect(queueOfflineQueueAction(ownerId, eventId, provisional!.id, 'CALL')).rejects.toThrow(/provisional/i);
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ pending: 1, conflicts: 0 });

    const routeRecord = (await rawRecords()).find(({ kind }) => kind === 'route');
    expect(routeRecord).toBeDefined();
    const ciphertext = new TextDecoder().decode(routeRecord?.ciphertext);
    expect(ciphertext).not.toContain(registrationId);
    expect(ciphertext).not.toContain('QUEUE_BALANCING');

    post.mockImplementationOnce(async (_url, body) => {
      const request = body as { clientBatchId: string; actions: Array<{ clientActionId: string }> };
      return { data: {
        clientBatchId: request.clientBatchId,
        serverTime: issuedAt,
        actions: [{
          clientActionId: request.actions[0].clientActionId,
          status: 'APPLIED' as const,
          retryCount: 0,
          result: canonicalRoute(),
        }],
      } };
    });

    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 1, pending: 0, conflicts: 0 });
    expect(post.mock.calls[0][0]).toBe(`/events/${eventId}/sync/operations`);
    expect(post.mock.calls[0][1]).toMatchObject({ actions: [{
      type: 'ROUTE_OVERRIDE',
      registrationId,
      stationIds: [nextStationId, currentStationId],
      reasonCode: 'QUEUE_BALANCING',
      expectedVersion: 3,
      skipActive: true,
    }] });
    expect(post.mock.calls[0][1]).not.toHaveProperty('actions.0.occurredAt');
    expect(post.mock.calls[0][1]).not.toHaveProperty('actions.0.provisionalQueueId');
    await expect(getOfflineParticipantRoute(ownerId, eventId, registrationId)).resolves.toEqual(canonicalRoute());
    const canonicalQueue = await getOfflineQueueStatus(ownerId, eventId);
    expect(canonicalQueue?.entries).toContainEqual(expect.objectContaining({ id: canonicalQueueId, stationId: nextStationId }));
    expect(canonicalQueue?.entries.some(({ id }) => id.startsWith('local-route:'))).toBe(false);
    expect((await rawRecords()).filter(({ kind }) => kind === 'route')).toHaveLength(0);
  });

  it('keeps a conflicted route encrypted and preserves its optimistic projection across a pack refresh', async () => {
    get.mockResolvedValueOnce(packResponse());
    await downloadOfflineEvent(ownerId, eventId);
    const optimistic = await queueOfflineRouteOverride(ownerId, eventId, registrationId, {
      stationIds: [nextStationId, currentStationId],
      reasonCode: 'STATION_UNAVAILABLE',
      expectedVersion: 3,
      skipActive: true,
    });

    post.mockImplementationOnce(async (_url, body) => {
      const request = body as { clientBatchId: string; actions: Array<{ clientActionId: string }> };
      return { data: {
        clientBatchId: request.clientBatchId,
        serverTime: issuedAt,
        actions: [{
          clientActionId: request.actions[0].clientActionId,
          status: 'CONFLICT' as const,
          retryCount: 0,
          errorCode: 'ROUTE_VERSION_CONFLICT',
        }],
      } };
    });
    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ synced: 0, pending: 0, conflicts: 1 });

    get.mockResolvedValueOnce(packResponse(route));
    await downloadOfflineEvent(ownerId, eventId);
    await expect(getOfflineParticipantRoute(ownerId, eventId, registrationId)).resolves.toEqual(optimistic);
    expect((await getOfflineQueueStatus(ownerId, eventId))?.entries.some(({ id }) => id.startsWith('local-route:'))).toBe(true);
    expect(await getOfflineSyncStatus(ownerId, eventId)).toMatchObject({ pending: 0, conflicts: 1 });
    await expect(queueOfflineRouteOverride(ownerId, eventId, registrationId, {
      stationIds: [nextStationId, currentStationId],
      reasonCode: 'STATION_UNAVAILABLE',
      expectedVersion: 4,
      skipActive: true,
    })).rejects.toThrow(/waiting for sync or conflict resolution/i);
  });
});
