import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../react-user-dashboard/src/utils/apiClient', () => ({
  default: { get, post },
}));
vi.mock('../../react-user-dashboard/src/utils/session', () => ({
  getStoredSession: () => ({ user: { id: ownerId } }),
}));

import {
  clearOfflineData,
  discardOfflineConflicts,
  downloadOfflineEvent,
  queueOfflineStationSave,
  resolveOfflineRegistration,
  syncOfflineEvent,
} from '../../react-user-dashboard/src/features/screening/offlineSync';
import { screeningApi } from '../../react-user-dashboard/src/features/screening/screeningApi';

const ownerId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const stationId = '33333333-3333-4333-8333-333333333333';
const registrationId = '44444444-4444-4444-8444-444444444444';

function response(actions: Array<{ clientActionId: string; status: 'CONFLICT'; retryCount: number }> = []) {
  return {
    data: {
      clientBatchId: crypto.randomUUID(),
      serverTime: '2026-08-13T01:00:00.000Z',
      cursor: '2026-08-13T01:00:00.000Z',
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
          offlineAccessExpiresAt: '2099-08-13T09:00:00.000Z',
          registrations: [{
            registrationId,
            participantDisplayName: 'Offline Participant',
            queueNumber: 7,
            status: 'WAITING',
            existingResult: null,
          }],
        }],
      },
    },
  };
}

beforeEach(async () => {
  get.mockReset();
  post.mockReset();
  await clearOfflineData();
});

describe('offline no-QR recovery', () => {
  it('resolves an encrypted registration and lets staff discard a rejected save', async () => {
    post.mockResolvedValueOnce(response());
    await downloadOfflineEvent(ownerId, eventId);

    await expect(resolveOfflineRegistration(ownerId, eventId, registrationId)).resolves.toMatchObject({
      registrationId,
      participantDisplayName: 'Offline Participant',
      queueNumber: 7,
      activeStation: { stationId, stationName: 'Visual Acuity', stationType: 'VISUAL_ACUITY' },
    });
    get.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ERR_NETWORK' }));
    await expect(screeningApi.resolve(eventId, { registrationId })).resolves.toMatchObject({
      registrationId,
      activeStation: { stationId },
    });

    await queueOfflineStationSave(ownerId, eventId, stationId, 'visual-acuity', {
      registrationId,
      idempotencyKey: crypto.randomUUID(),
      acknowledged: false,
      resultData: {
        chartDistanceMetres: 6,
        od: { kind: 'FRACTION', denominator: 6 },
        os: { kind: 'FRACTION', denominator: 6 },
        withUsualDistanceGlasses: true,
      },
    });
    post.mockImplementationOnce(async (_url, body) => response([{
      clientActionId: body.actions[0].clientActionId,
      status: 'CONFLICT',
      retryCount: 0,
    }]));

    await expect(syncOfflineEvent(ownerId, eventId)).resolves.toMatchObject({ conflicts: 1, pending: 0 });
    await expect(discardOfflineConflicts(ownerId, eventId)).resolves.toMatchObject({ conflicts: 0, pending: 0 });
  });
});
