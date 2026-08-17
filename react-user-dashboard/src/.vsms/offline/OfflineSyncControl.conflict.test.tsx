/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncEvent: vi.fn(),
  status: {
    downloaded: true,
    pending: 0,
    conflicts: 1,
    locked: 0,
    expiresAt: '2099-08-17T10:00:00.000Z',
    snapshotBytes: 2048,
    conflictCodes: ['QUEUE_STATE_CONFLICT'],
    downloading: false,
    syncing: false,
    error: null,
  },
}));

vi.mock('../../features/screening/OfflineSyncProvider', () => ({
  useOfflineSync: () => ({
    online: false,
    autoSync: true,
    setAutoSync: vi.fn(),
    statusFor: () => mocks.status,
    downloadEvent: vi.fn(),
    syncEvent: mocks.syncEvent,
    clearDeviceData: vi.fn(),
    ensureOfflineReady: vi.fn(),
  }),
}));

import { OfflineSyncControl } from '../../features/screening/OfflineSyncControl';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('offline conflict retention', () => {
  it('labels conflicts as encrypted recovery data and offers no discard action', () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<OfflineSyncControl eventId="22222222-2222-4222-8222-222222222222" />);

    const retained = screen.getByRole('button', { name: '1 conflict retained' });
    expect(screen.getByText(/retained encrypted for supervised recovery/i)).toBeTruthy();
    expect(retained.getAttribute('title')).toContain('QUEUE_STATE_CONFLICT');
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull();
    fireEvent.click(retained);
    expect(mocks.syncEvent).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
});
