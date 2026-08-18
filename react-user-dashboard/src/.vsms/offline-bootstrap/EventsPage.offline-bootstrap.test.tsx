/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  ensureOfflineReady: vi.fn(),
  downloadEvent: vi.fn(),
  syncEvent: vi.fn(),
  list: vi.fn(),
  online: true,
  roles: ['SCREENER'] as string[],
  status: {
    downloaded: false,
    pending: 0,
    conflicts: 0,
    locked: 0,
    expiresAt: null,
    snapshotBytes: null,
    conflictCodes: [],
    downloading: true,
    syncing: false,
    error: null as string | null,
  },
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'staff-1', roles: dependencies.roles } } }),
}));
vi.mock('../../features/screening/OfflineSyncProvider', () => ({
  useOfflineSync: () => ({
    online: dependencies.online,
    ensureOfflineReady: dependencies.ensureOfflineReady,
    downloadEvent: dependencies.downloadEvent,
    syncEvent: dependencies.syncEvent,
    statusFor: () => dependencies.status,
  }),
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
  dependencies.online = true;
  dependencies.ensureOfflineReady.mockReset().mockResolvedValue(undefined);
  dependencies.downloadEvent.mockReset().mockResolvedValue(undefined);
  dependencies.syncEvent.mockReset().mockResolvedValue(undefined);
  dependencies.status = {
    downloaded: false, pending: 0, conflicts: 0, locked: 0, expiresAt: null,
    snapshotBytes: null, conflictCodes: [], downloading: true, syncing: false, error: null,
  };
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

  it('does not prepare an event whose audited running state outlived its schedule', async () => {
    dependencies.list.mockResolvedValueOnce({
      events: [{ ...runningEvent, endsAt: '2020-08-18T09:00:00.000Z' }],
      nextCursor: null,
    });
    render(<MemoryRouter><EventsPage /></MemoryRouter>);

    await waitFor(() => expect(dependencies.list).toHaveBeenCalled());
    expect(dependencies.ensureOfflineReady).not.toHaveBeenCalled();
  });

  it('prepares the running event when connectivity returns', async () => {
    dependencies.online = false;
    const view = render(<MemoryRouter><EventsPage /></MemoryRouter>);
    await waitFor(() => expect(dependencies.list).toHaveBeenCalled());
    expect(dependencies.ensureOfflineReady).not.toHaveBeenCalled();

    dependencies.online = true;
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    await waitFor(() => expect(dependencies.ensureOfflineReady).toHaveBeenCalledWith(runningEvent.eventId));
  });

  it('shows each offline lifecycle state on the running event', async () => {
    const view = render(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(await screen.findByText('Preparing offline')).toBeTruthy();

    dependencies.status = { ...dependencies.status, downloading: false, syncing: true };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.getByText('Syncing')).toBeTruthy();

    dependencies.status = { ...dependencies.status, syncing: false, conflicts: 2 };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.getByText('2 sync conflicts')).toBeTruthy();

    dependencies.status = { ...dependencies.status, conflicts: 0, locked: 1 };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.getByText('1 locked for recovery')).toBeTruthy();

    dependencies.status = { ...dependencies.status, downloading: false, downloaded: true, locked: 0 };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.getByText('Offline ready')).toBeTruthy();

    dependencies.status = { ...dependencies.status, pending: 3 };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.getByText('3 waiting to sync')).toBeTruthy();

    dependencies.online = false;
    dependencies.status = { ...dependencies.status, downloaded: false, pending: 0 };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.getByText('Not saved offline')).toBeTruthy();
  });

  it('retries the failed operation without making conflicts or offline failures actionable', async () => {
    const view = render(<MemoryRouter><EventsPage /></MemoryRouter>);
    await screen.findByText('Preparing offline');

    dependencies.status = { ...dependencies.status, downloading: false, pending: 0, error: 'The offline pack could not be downloaded.' };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry offline download' }));
    expect(dependencies.downloadEvent).toHaveBeenCalledWith(runningEvent.eventId);

    dependencies.status = { ...dependencies.status, downloaded: true, error: 'Sync failed.' };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    expect(dependencies.syncEvent).toHaveBeenCalledWith(runningEvent.eventId);
    expect(screen.getByText('Sync failed.')).toBeTruthy();

    dependencies.status = { ...dependencies.status, conflicts: 1 };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.queryByRole('button')).toBeNull();

    dependencies.online = false;
    dependencies.status = { ...dependencies.status, downloaded: false, conflicts: 0 };
    view.rerender(<MemoryRouter><EventsPage /></MemoryRouter>);
    expect(screen.getByText('Not saved offline')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
