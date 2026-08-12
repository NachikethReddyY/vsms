import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/apiClient', () => ({
  default: { post: vi.fn() },
}));

import apiClient from '../../utils/apiClient';
import {
  clearOfflineData,
  downloadOfflineEvent,
  getOfflineStationContext,
  getOfflineSyncStatus,
  purgeExpiredOfflineData,
  queueOfflineStationSave,
  syncOfflineEvent,
} from './offlineSync';

const ownerId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const stationId = '33333333-3333-4333-8333-333333333333';
const registrationId = '44444444-4444-4444-8444-444444444444';
const expiry = '2099-08-05T09:00:00.000Z';
const post = vi.mocked(apiClient.post);

type ActionResult = {
  clientActionId: string;
  status: 'APPLIED' | 'CONFLICT' | 'FAILED';
  retryCount: number;
  errorCode?: string;
  result?: {
    routeProgression?: {
      status: 'ADDED_TO_QUEUE' | 'REVIEW_READY' | 'BLOCKED' | 'CORRECTION_SAVED';
      routeVersion?: number;
      completedStation?: { stationId: string; stationName: string; stationType: string } | null;
      nextStation?: { stationId: string; stationName: string; stationType: string } | null;
      nextQueue?: { stationId: string; stationName: string; stationType: string; queueNumber: number; status: 'WAITING' } | null;
    } | null;
  };
};

type SyncRequest = {
  actions: Array<{
    clientActionId: string;
    stationId: string;
    stationType: string;
    payload: { registrationId: string };
  }>;
};

const syncRequest = (value: unknown) => value as SyncRequest;

function response(actions: ActionResult[] = [], expiresAt = expiry) {
  return {
    data: {
      clientBatchId: crypto.randomUUID(),
      serverTime: '2026-08-04T10:00:00.000Z',
      cursor: '2026-08-04T10:00:00.000Z',
      actions,
      pull: {
        event: { eventId, name: 'Vision Screening', status: 'IN_PROGRESS' },
        stations: [{
          stationId,
          eventId,
          stationName: 'Visual Acuity',
          stationType: 'VISUAL_ACUITY',
          stationOrder: 1,
          isActive: true,
          offlineAccessExpiresAt: expiresAt,
          registrations: [{
            registrationId,
            participantDisplayName: 'Encrypted Queue Person',
            queueNumber: 1,
            status: 'CHECKED_IN',
            passToken: 'defensively-removed-pass-token',
            existingResult: null,
          }],
        }],
      },
    },
  };
}

function saveBody() {
  return {
    registrationId,
    idempotencyKey: crypto.randomUUID(),
    acknowledged: false,
    resultData: {
      chartDistanceMetres: 6 as const,
      od: { kind: 'FRACTION' as const, denominator: 6 },
      os: { kind: 'FRACTION' as const, denominator: 6 },
      withUsualDistanceGlasses: true,
    },
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
  post.mockReset();
  vi.useRealTimers();
  await clearOfflineData();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('encrypted screening outbox', () => {
  it('downloads only through batch sync and encrypts the scoped snapshot at rest', async () => {
    post.mockResolvedValueOnce(response());

    await downloadOfflineEvent(ownerId, eventId);

    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0][0]).toBe(`/events/${eventId}/sync/screening`);
    expect(post.mock.calls[0][1]).toMatchObject({ actions: [] });
    const context = await getOfflineStationContext(ownerId, eventId, 'VISUAL_ACUITY');
    expect(context?.queue[0]).toMatchObject({
      participantDisplayName: 'Encrypted Queue Person',
      passToken: null,
    });

    const records = await rawRecords();
    expect(records).toHaveLength(1);
    const bytes = new TextDecoder().decode(records[0].ciphertext);
    expect(bytes).not.toContain('Encrypted Queue Person');
    expect(bytes).not.toContain('defensively-removed-pass-token');
    expect(bytes).not.toContain(registrationId);
  });

  it('pushes a stable encrypted action through the batch API and clears it only when applied', async () => {
    post.mockResolvedValueOnce(response());
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody());

    const encrypted = (await rawRecords()).find((record) => record.kind === 'mutation');
    const bytes = new TextDecoder().decode(encrypted?.ciphertext);
    expect(bytes).not.toContain(registrationId);
    expect(bytes).not.toContain('chartDistanceMetres');

    const nextStationId = '55555555-5555-4555-8555-555555555555';
    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'APPLIED',
      retryCount: 0,
      result: {
        routeProgression: {
          status: 'ADDED_TO_QUEUE',
          routeVersion: 2,
          completedStation: { stationId, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY' },
          nextStation: { stationId: nextStationId, stationName: 'Refraction', stationType: 'REFRACTION' },
          nextQueue: { stationId: nextStationId, stationName: 'Refraction', stationType: 'REFRACTION', queueNumber: 1, status: 'WAITING' },
        },
      },
    }]));
    const result = await syncOfflineEvent(ownerId, eventId);

    expect(result).toMatchObject({
      pending: 0,
      conflicts: 0,
      synced: 1,
      expired: false,
      committedProgressions: [{
        routeProgression: {
          status: 'ADDED_TO_QUEUE',
          nextQueue: { stationName: 'Refraction', status: 'WAITING' },
        },
      }],
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0]).toBe(`/events/${eventId}/sync/screening`);
    expect(syncRequest(post.mock.calls[1][1]).actions[0]).toMatchObject({
      stationId,
      stationType: 'VISUAL_ACUITY',
      payload: { registrationId },
    });
    expect(post.mock.calls.some(([url]) => String(url).includes(`/stations/${stationId}/visual-acuity`))).toBe(false);
  });

  it('keeps failures retryable across reconnect and surfaces server conflicts', async () => {
    post.mockResolvedValueOnce(response());
    await downloadOfflineEvent(ownerId, eventId);
    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', saveBody());

    post.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ERR_NETWORK' }));
    expect(await syncOfflineEvent(ownerId, eventId)).toMatchObject({ pending: 1, synced: 0, committedProgressions: [] });

    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'FAILED',
      retryCount: 0,
      errorCode: 'SYNC_APPLY_FAILED',
    }]));
    expect(await syncOfflineEvent(ownerId, eventId)).toMatchObject({ pending: 1, conflicts: 0, synced: 0, committedProgressions: [] });

    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: syncRequest(body).actions[0].clientActionId,
      status: 'CONFLICT',
      retryCount: 1,
      errorCode: 'ROUTE_STATION_MISMATCH',
      result: {
        routeProgression: {
          status: 'ADDED_TO_QUEUE',
          nextQueue: {
            stationId,
            stationName: 'Must not be shown',
            stationType: 'VISUAL_ACUITY',
            queueNumber: 99,
            status: 'WAITING',
          },
        },
      },
    }]));
    expect(await syncOfflineEvent(ownerId, eventId)).toMatchObject({ pending: 0, conflicts: 1, synced: 0, committedProgressions: [] });
  });

  it('ignores eye-health stations in offline downloads because eye health is review-only', async () => {
    const eyeStationId = '55555555-5555-4555-8555-555555555555';
    const vaStationId = '11111111-1111-4111-8111-111111111111';
    post.mockResolvedValueOnce({
      data: {
        ...response().data,
        pull: {
          event: { eventId, name: 'Vision Screening', status: 'IN_PROGRESS' },
          stations: [
            {
              stationId: vaStationId,
              eventId,
              stationName: 'Visual Acuity',
              stationType: 'VISUAL_ACUITY',
              stationOrder: 1,
              isActive: true,
              offlineAccessExpiresAt: expiry,
              registrations: [{
                registrationId,
                participantDisplayName: 'Encrypted Queue Person',
                queueNumber: 1,
                status: 'CHECKED_IN',
                passToken: null,
                existingResult: null,
              }],
            },
            {
              stationId: eyeStationId,
              eventId,
              stationName: 'Eye Health',
              stationType: 'EYE_HEALTH',
              stationOrder: 4,
              isActive: true,
              offlineAccessExpiresAt: expiry,
              registrations: [{
                registrationId,
                participantDisplayName: 'Encrypted Queue Person',
                queueNumber: 1,
                status: 'CHECKED_IN',
                passToken: null,
                existingResult: null,
              }],
            },
          ],
        },
      },
    });
    await downloadOfflineEvent(ownerId, eventId);
    expect(await getOfflineStationContext(ownerId, eventId, 'VISUAL_ACUITY')).toBeTruthy();
    expect(await getOfflineStationContext(ownerId, eventId, 'EYE_HEALTH')).toBeNull();
  });

  it('purges expired and logout-cleared encrypted data', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.parse('2026-08-04T10:00:00.000Z'));
    post.mockResolvedValueOnce(response([], '2026-08-04T11:00:00.000Z'));
    await downloadOfflineEvent(ownerId, eventId);

    now.mockReturnValue(Date.parse('2026-08-04T12:00:00.000Z'));
    await purgeExpiredOfflineData(ownerId);
    expect(await getOfflineSyncStatus(ownerId, eventId)).toEqual({
      downloaded: false,
      pending: 0,
      conflicts: 0,
      expiresAt: null,
    });

    now.mockReturnValue(Date.parse('2026-08-04T10:00:00.000Z'));
    post.mockResolvedValueOnce(response([], '2026-08-04T11:00:00.000Z'));
    await downloadOfflineEvent(ownerId, eventId);
    await clearOfflineData();
    expect(await rawRecords()).toEqual([]);
  });
});
