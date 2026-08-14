import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, queueOfflineStationSave, resolveOfflineRegistration } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  queueOfflineStationSave: vi.fn(),
  resolveOfflineRegistration: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({ default: { get, post } }));
vi.mock('../../utils/session', () => ({
  getStoredSession: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
}));
vi.mock('./offlineSync', () => ({
  evaluateOfflineStation: vi.fn(),
  isNetworkError: (error: unknown) => (error as { code?: string })?.code === 'ERR_NETWORK',
  queueOfflineStationSave,
  resolveOfflineRegistration,
}));

import { screeningApi } from './screeningApi';

const eventId = '22222222-2222-4222-8222-222222222222';
const stationId = '33333333-3333-4333-8333-333333333333';
const body = {
  registrationId: '44444444-4444-4444-8444-444444444444',
  idempotencyKey: 'offline-result-1',
  acknowledged: false,
  resultData: {
    chartDistanceMetres: 6 as const,
    od: { kind: 'FRACTION' as const, denominator: 6 },
    os: { kind: 'FRACTION' as const, denominator: 6 },
    withUsualDistanceGlasses: true,
  },
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  queueOfflineStationSave.mockReset();
  resolveOfflineRegistration.mockReset();
});

it('unwraps the queue response when resolving a participant pass', async () => {
  get
    .mockResolvedValueOnce({ data: { registrationId: body.registrationId, participantDisplayName: 'Keefe Chen', queueNumber: 1, status: 'SIGNED_UP' } })
    .mockResolvedValueOnce({ data: { data: { activeEntry: { station: { stationId, stationName: 'Visual main', stationType: 'VISUAL_ACUITY' } } } } });

  await expect(screeningApi.resolve(eventId, { registrationId: body.registrationId })).resolves.toMatchObject({
    participantDisplayName: 'Keefe Chen',
    activeStation: { stationId, stationName: 'Visual main' },
  });
});

describe('screening save synchronization state', () => {
  it('marks an offline save pending without claiming route progression', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ERR_NETWORK' }));
    queueOfflineStationSave.mockResolvedValueOnce({
      overallFlag: 'NORMAL',
      isFlagged: false,
      flagSummary: 'VA normal',
      ruleVersion: 'VSMS-VA-1.0',
      reasons: [],
    });

    const saved = await screeningApi.saveVisualAcuity(eventId, stationId, body);

    expect(saved).toMatchObject({ queued: true, syncState: 'PENDING_SYNC' });
    expect(saved.routeProgression).toBeUndefined();
    expect(queueOfflineStationSave).toHaveBeenCalledOnce();
  });

  it('marks server progression committed only after the mutation succeeds', async () => {
    post.mockResolvedValueOnce({
      data: {
        resultId: '55555555-5555-4555-8555-555555555555',
        overallFlag: 'NORMAL',
        isFlagged: false,
        flagSummary: null,
        resultData: body.resultData,
        routeProgression: {
          status: 'ADDED_TO_QUEUE',
          routeVersion: 2,
          nextStation: { stationId, stationName: 'Refraction', stationType: 'REFRACTION' },
          nextQueue: { stationId, stationName: 'Refraction', stationType: 'REFRACTION', queueNumber: 4, status: 'WAITING' },
        },
      },
    });

    const saved = await screeningApi.saveVisualAcuity(eventId, stationId, body);

    expect(saved.syncState).toBe('COMMITTED');
    expect(saved.routeProgression).toMatchObject({
      status: 'ADDED_TO_QUEUE',
      nextQueue: { stationName: 'Refraction', status: 'WAITING' },
    });
    expect(queueOfflineStationSave).not.toHaveBeenCalled();
  });
});
