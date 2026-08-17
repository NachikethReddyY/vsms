import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/apiClient', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('../../utils/session', () => ({
  getStoredSession: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' }, expiresAt: Date.now() + 60_000 }),
}));
vi.mock('../../features/screening/offlineSync', () => ({
  getOfflineEvent: vi.fn(),
  isNetworkError: vi.fn(() => true),
  listOfflineEvents: vi.fn(),
  queueOfflineStationAvailability: vi.fn(),
}));

import apiClient from '../../utils/apiClient';
import { eventApi, type EventRecord } from '../../features/events/eventApi';
import { getOfflineEvent, listOfflineEvents, queueOfflineStationAvailability } from '../../features/screening/offlineSync';

const event = {
  eventId: '22222222-2222-4222-8222-222222222222',
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Offline Event',
  venue: 'Community Hall',
  startsAt: '2099-08-05T01:00:00.000Z',
  status: 'IN_PROGRESS',
} as EventRecord;

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset();
  vi.mocked(apiClient.patch).mockReset();
  vi.mocked(getOfflineEvent).mockReset();
  vi.mocked(listOfflineEvents).mockReset();
  vi.mocked(queueOfflineStationAvailability).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('eventApi offline reads', () => {
  it('lists and opens prepared events without making a request while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(listOfflineEvents).mockResolvedValue([event]);
    vi.mocked(getOfflineEvent).mockResolvedValue(event);

    await expect(eventApi.list()).resolves.toMatchObject({ events: [{ name: 'Offline Event' }] });
    await expect(eventApi.get(event.eventId)).resolves.toMatchObject({ eventId: event.eventId, scope: 'DEVICE_LOCAL' });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('uses the prepared event when a reported connection fails', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.mocked(apiClient.get).mockRejectedValue(Object.assign(new Error('offline'), { code: 'ERR_NETWORK' }));
    vi.mocked(listOfflineEvents).mockResolvedValue([event]);

    await expect(eventApi.list()).resolves.toMatchObject({ events: [{ eventId: event.eventId }] });
  });

  it('queues an availability-only station change locally even when the browser reports online', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.mocked(getOfflineEvent).mockResolvedValue(event);
    vi.mocked(queueOfflineStationAvailability).mockResolvedValue({ ...event, version: 8 });

    await expect(eventApi.updateStation(event.eventId, '33333333-3333-4333-8333-333333333333', {
      version: 7,
      isAvailable: false,
    })).resolves.toMatchObject({ version: 8, scope: 'DEVICE_LOCAL' });
    expect(queueOfflineStationAvailability).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      event.eventId,
      '33333333-3333-4333-8333-333333333333',
      false,
      7,
    );
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});
