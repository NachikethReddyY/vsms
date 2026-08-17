import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/apiClient', () => ({ default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../utils/session', () => ({
  getStoredSession: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' }, expiresAt: Date.now() + 60_000 }),
}));
vi.mock('../../features/screening/offlineSync', () => ({
  getOfflineParticipantRoute: vi.fn(),
  getOfflineQueueStatus: vi.fn(),
  queueOfflineQueueAction: vi.fn(),
  queueOfflineRouteOverride: vi.fn(),
}));

import apiClient from '../../utils/apiClient';
import { queueApi, type EventQueueStatus, type QueueEntry, type RegistrationRouteState } from '../../features/queue/queueApi';
import {
  getOfflineParticipantRoute,
  getOfflineQueueStatus,
  queueOfflineQueueAction,
  queueOfflineRouteOverride,
} from '../../features/screening/offlineSync';

const eventId = '22222222-2222-4222-8222-222222222222';
const queueId = '33333333-3333-4333-8333-333333333333';
const entry = {
  id: queueId,
  queueNumber: 12,
  status: 'WAITING',
  isPriority: false,
  registrationId: '44444444-4444-4444-8444-444444444444',
  stationId: '55555555-5555-4555-8555-555555555555',
} satisfies QueueEntry;
const queue = {
  event: { eventId, name: 'Offline Event', status: 'IN_PROGRESS', venue: null },
  stations: [],
  totals: { WAITING: 1, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
  entries: [entry],
} satisfies EventQueueStatus;
const route = {
  status: 'READY',
  routeVersion: 3,
  steps: [{
    stationId: entry.stationId,
    stationName: 'Visual acuity',
    stationType: 'VISUAL_ACUITY',
    position: 1,
    state: 'CURRENT',
  }],
  currentStation: {
    stationId: entry.stationId,
    stationName: 'Visual acuity',
    stationType: 'VISUAL_ACUITY',
    position: 1,
    state: 'CURRENT',
  },
  queue: { queueEntryId: queueId, stationId: entry.stationId, queueNumber: 12, status: 'WAITING' },
} satisfies RegistrationRouteState;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOfflineQueueStatus).mockResolvedValue(queue);
  vi.mocked(getOfflineParticipantRoute).mockResolvedValue(route);
});

describe('queueApi local-first operations', () => {
  it('reads a prepared queue without a network request', async () => {
    await expect(queueApi.getEventQueueStatus(eventId)).resolves.toEqual(queue);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('records queue transitions locally before sync', async () => {
    vi.mocked(queueOfflineQueueAction).mockResolvedValue({ ...entry, status: 'CALLED' });

    await expect(queueApi.callQueueEntry(eventId, queueId)).resolves.toMatchObject({ status: 'CALLED' });
    expect(queueOfflineQueueAction).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111', eventId, queueId, 'CALL',
    );
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('records leaving a prepared queue locally without calling the delete endpoint', async () => {
    vi.mocked(queueOfflineQueueAction).mockResolvedValue({ ...entry, status: 'CANCELLED' });

    await expect(queueApi.leaveQueueEntry(eventId, queueId)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(queueOfflineQueueAction).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111', eventId, queueId, 'LEAVE',
    );
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it('uses the event-scoped delete endpoint when no local queue is prepared', async () => {
    vi.mocked(getOfflineQueueStatus).mockResolvedValue(null);
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { ...entry, status: 'CANCELLED' } });

    await expect(queueApi.leaveQueueEntry(eventId, queueId)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(apiClient.delete).toHaveBeenCalledWith(`/events/${eventId}/entries/${queueId}`);
    expect(queueOfflineQueueAction).not.toHaveBeenCalled();
  });

  it('reads and replaces prepared participant routes without a network request', async () => {
    const request = {
      stationIds: [entry.stationId],
      reasonCode: 'PARTICIPANT_NEED' as const,
      expectedVersion: 3,
      skipActive: true,
    };
    vi.mocked(queueOfflineRouteOverride).mockResolvedValue({ ...route, status: 'REVIEW_READY', routeVersion: 4 });

    await expect(queueApi.getParticipantRoute(eventId, entry.registrationId)).resolves.toEqual(route);
    await expect(queueApi.replaceParticipantRoute(eventId, entry.registrationId, request))
      .resolves.toMatchObject({ routeVersion: 4 });
    expect(queueOfflineRouteOverride).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111', eventId, entry.registrationId, request,
    );
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});
