import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/apiClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../utils/session', () => ({
  getStoredSession: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
}));
vi.mock('../../features/screening/offlineSync', () => ({
  getOfflineQueueStatus: vi.fn(),
  getOfflineSyncStatus: vi.fn(),
  isNetworkError: vi.fn(() => true),
  listOfflineEvents: vi.fn(),
}));

import apiClient from '../../utils/apiClient';
import { operationsApi } from '../../features/operations/operationsApi';
import { reportApi } from '../../features/reports/reportApi';
import { getOfflineQueueStatus, getOfflineSyncStatus, listOfflineEvents } from '../../features/screening/offlineSync';

const eventId = '22222222-2222-4222-8222-222222222222';
const event = {
  eventId,
  name: 'Offline Event',
  venue: 'Community Hall',
  timezone: 'Asia/Singapore',
  startsAt: '2026-08-17T01:00:00.000Z',
  endsAt: '2026-08-17T09:00:00.000Z',
  status: 'IN_PROGRESS',
  capacity: 100,
  signupCount: 12,
  activeCapacityCount: 9,
  shifts: [],
};
const queue = {
  event: { eventId, name: event.name, status: event.status, venue: event.venue },
  stations: [],
  totals: { WAITING: 3, CALLED: 1, IN_PROGRESS: 2, COMPLETED: 4, SKIPPED: 1, CANCELLED: 0 },
  entries: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { onLine: false });
  vi.mocked(listOfflineEvents).mockResolvedValue([event] as never);
  vi.mocked(getOfflineQueueStatus).mockResolvedValue(queue as never);
  vi.mocked(getOfflineSyncStatus).mockResolvedValue({ pending: 2, conflicts: 1 } as never);
});

describe('offline operational projections', () => {
  it('labels operations as device-local and derives queue counts without the network', async () => {
    const result = await operationsApi.overview({ status: 'ALL' });
    expect(result).toMatchObject({ scope: 'DEVICE_LOCAL', summary: { queue: { waiting: 3, active: 3 } } });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('labels reports as provisional device snapshots and preserves sync issues', async () => {
    const result = await reportApi.operations({ from: '2026-08-17', to: '2026-08-17' });
    expect(result).toMatchObject({ scope: 'DEVICE_LOCAL', summary: { sync: { pending: 2, issues: 1 } } });
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
