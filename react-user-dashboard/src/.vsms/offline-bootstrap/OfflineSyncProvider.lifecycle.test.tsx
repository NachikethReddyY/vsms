/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  auth: { session: null as { user: { id: string } } | null, isAuthenticated: false },
  clearOfflineData: vi.fn(),
  listOfflineEventIds: vi.fn(async () => [] as string[]),
  syncOfflineEvent: vi.fn(),
}));

vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => dependencies.auth }));
vi.mock('../../utils/session', () => ({ getStoredSession: () => dependencies.auth.session }));
vi.mock('../../features/screening/offlineSync', () => ({
  clearOfflineData: dependencies.clearOfflineData,
  downloadOfflineEvent: vi.fn(),
  getOfflineSyncStatus: vi.fn(),
  listOfflineEventIds: dependencies.listOfflineEventIds,
  offlineSyncChangeEvent: 'vsms-offline-sync',
  purgeExpiredOfflineData: vi.fn(),
  syncOfflineEvent: dependencies.syncOfflineEvent,
}));

const { OfflineSyncProvider, useOfflineSync } = await import('../../features/screening/OfflineSyncProvider');

function Controls() {
  const { clearDeviceData } = useOfflineSync();
  return <button onClick={() => void clearDeviceData()}>Purge device</button>;
}

beforeEach(() => {
  dependencies.auth = { session: { user: { id: 'staff-1' } }, isAuthenticated: true };
  dependencies.clearOfflineData.mockReset().mockResolvedValue(undefined);
  dependencies.listOfflineEventIds.mockClear();
  dependencies.listOfflineEventIds.mockResolvedValue([]);
  dependencies.syncOfflineEvent.mockReset().mockResolvedValue({
    downloaded: true,
    pending: 0,
    conflicts: 0,
    locked: 0,
    expiresAt: '2099-08-17T10:00:00.000Z',
    snapshotBytes: 1024,
    conflictCodes: [],
    synced: 0,
    expired: false,
    committedProgressions: [],
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});

afterEach(cleanup);

describe('offline data lifecycle', () => {
  it('locks without deleting encrypted records on logout or account changes', async () => {
    const view = render(<OfflineSyncProvider><Controls /></OfflineSyncProvider>);
    await waitFor(() => expect(dependencies.listOfflineEventIds).toHaveBeenCalled());

    dependencies.auth = { session: null, isAuthenticated: false };
    view.rerender(<OfflineSyncProvider><Controls /></OfflineSyncProvider>);
    dependencies.auth = { session: { user: { id: 'staff-2' } }, isAuthenticated: true };
    view.rerender(<OfflineSyncProvider><Controls /></OfflineSyncProvider>);

    await waitFor(() => expect(dependencies.listOfflineEventIds).toHaveBeenCalled());
    expect(dependencies.clearOfflineData).not.toHaveBeenCalled();
  });

  it('keeps deliberate device purging available', async () => {
    render(<OfflineSyncProvider><Controls /></OfflineSyncProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Purge device' }));

    await waitFor(() => expect(dependencies.clearOfflineData).toHaveBeenCalledOnce());
  });

  it('retries existing offline work when the online app returns to the foreground', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    dependencies.listOfflineEventIds.mockResolvedValue(['event-1']);
    render(<OfflineSyncProvider><Controls /></OfflineSyncProvider>);
    await waitFor(() => expect(dependencies.syncOfflineEvent).toHaveBeenCalledWith('staff-1', 'event-1'));
    dependencies.syncOfflineEvent.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(dependencies.syncOfflineEvent).toHaveBeenCalledWith('staff-1', 'event-1'));
  });
});
