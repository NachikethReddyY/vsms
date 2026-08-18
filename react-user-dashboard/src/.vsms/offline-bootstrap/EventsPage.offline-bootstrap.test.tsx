/* @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  ensureOfflineReady: vi.fn(),
  list: vi.fn(),
  roles: ['SCREENER'] as string[],
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'staff-1', roles: dependencies.roles } } }),
}));
vi.mock('../../features/screening/OfflineSyncProvider', () => ({
  useOfflineSync: () => ({ online: true, ensureOfflineReady: dependencies.ensureOfflineReady }),
}));
vi.mock('../../features/events/eventApi', () => ({ eventApi: { list: dependencies.list } }));
vi.mock('../../features/events/eventBanners', () => ({ getEventArtwork: () => 'data:image/svg+xml,placeholder' }));

import EventsPage from '../../components/EventsPage';

const runningEvent = {
  eventId: '22222222-2222-4222-8222-222222222222',
  name: 'Running Vision Day',
  venue: 'Community Hall',
  timezone: 'Asia/Singapore',
  startsAt: '2099-08-18T01:00:00.000Z',
  endsAt: '2099-08-18T09:00:00.000Z',
  status: 'IN_PROGRESS',
  activeCapacityCount: 0,
  capacity: 100,
  canManage: false,
  shifts: [],
  eventStations: [],
  eventDays: [],
};

beforeEach(() => {
  dependencies.roles = ['SCREENER'];
  dependencies.ensureOfflineReady.mockReset().mockResolvedValue(undefined);
  dependencies.list.mockReset().mockResolvedValue({ events: [runningEvent], nextCursor: null });
});
afterEach(cleanup);

describe('events offline bootstrap', () => {
  it('prepares an assigned running event before the event is opened', async () => {
    render(<MemoryRouter><EventsPage /></MemoryRouter>);

    await waitFor(() => expect(dependencies.ensureOfflineReady).toHaveBeenCalledWith(runningEvent.eventId));
  });

  it('does not prepare completed events or administrator sessions', async () => {
    dependencies.list.mockResolvedValueOnce({
      events: [{ ...runningEvent, status: 'COMPLETED' }],
      nextCursor: null,
    });
    const completed = render(<MemoryRouter><EventsPage /></MemoryRouter>);
    await waitFor(() => expect(dependencies.list).toHaveBeenCalled());
    expect(dependencies.ensureOfflineReady).not.toHaveBeenCalled();
    completed.unmount();

    dependencies.roles = ['ADMINISTRATOR'];
    dependencies.list.mockResolvedValueOnce({ events: [runningEvent], nextCursor: null });
    render(<MemoryRouter><EventsPage /></MemoryRouter>);
    await waitFor(() => expect(dependencies.list).toHaveBeenCalledTimes(2));
    expect(dependencies.ensureOfflineReady).not.toHaveBeenCalled();
  });
});
