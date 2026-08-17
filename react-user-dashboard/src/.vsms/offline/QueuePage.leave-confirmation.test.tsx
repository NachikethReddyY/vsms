/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEventQueueStatus: vi.fn(),
  leaveQueueEntry: vi.fn(),
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'staff-1', roles: [] } } }),
}));

vi.mock('../../auth/RoleGuard', () => ({ activeEventRoles: () => ['REGISTRATION_OFFICER'] }));
vi.mock('../../components/queue/NowServingCard', () => ({ NowServingCard: () => null }));
vi.mock('../../components/queue/RouteOverrideDialog', () => ({ RouteOverrideDialog: () => null }));
vi.mock('../../components/queue/QueueHeader', () => ({ QueueHeader: () => <div>Queue header</div> }));
vi.mock('../../components/queue/StationWorkload', () => ({ StationWorkload: () => null }));
vi.mock('../../components/ui', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  LoadingState: ({ label }: { label: string }) => <p>{label}</p>,
}));
vi.mock('../../components/queue/QueueTable', async () => {
  const actual = await vi.importActual<typeof import('../../components/queue/QueueTable')>('../../components/queue/QueueTable');
  return {
    ...actual,
    QueueTable: ({ onAction }: { onAction: (id: string, action: 'LEFT') => void }) => (
      <button type="button" onClick={() => onAction('queue-1', 'LEFT')}>Request leave</button>
    ),
  };
});
vi.mock('../../features/queue/queueApi', () => ({
  queueApi: {
    getEventQueueStatus: mocks.getEventQueueStatus,
    leaveQueueEntry: mocks.leaveQueueEntry,
  },
  sortWaitingByPriority: (entries: Array<{ status: string }>) => entries.filter((entry) => entry.status === 'WAITING'),
}));
vi.mock('../../features/screening/offlineSync', () => ({ getOfflineEventRoles: vi.fn() }));
vi.mock('../../features/stage4Api', () => ({
  getCurrentAccount: vi.fn(async () => ({ account: { eventMemberships: [] } })),
}));
vi.mock('../../utils/apiClient', () => ({
  getApiError: (_error: unknown, fallback: string) => fallback,
  getApiErrorCode: () => null,
}));

import { QueuePage } from '../../pages/QueuePages';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'setInterval').mockReturnValue(1);
  mocks.getEventQueueStatus.mockResolvedValue({
    event: { eventId: 'event-1', name: 'Clinic Day', status: 'IN_PROGRESS', venue: null },
    stations: [],
    totals: { WAITING: 1, CALLED: 0, IN_PROGRESS: 0, COMPLETED: 0, SKIPPED: 0, CANCELLED: 0 },
    entries: [{
      id: 'queue-1',
      registrationId: 'registration-1',
      queueNumber: 1,
      status: 'WAITING',
      isPriority: false,
      stationId: 'station-1',
      participantDisplayName: 'Participant 1',
    }],
  });
  mocks.leaveQueueEntry.mockResolvedValue({ status: 'CANCELLED' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('QueuePage leave confirmation', () => {
  it('does not remove an entry until the operator confirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MemoryRouter initialEntries={['/events/event-1/queue']}><Routes><Route path="/events/:eventId/queue" element={<QueuePage />} /></Routes></MemoryRouter>);

    const leave = await screen.findByRole('button', { name: 'Request leave' });
    await userEvent.click(leave);
    expect(mocks.leaveQueueEntry).not.toHaveBeenCalled();
    await userEvent.click(leave);
    await waitFor(() => expect(mocks.leaveQueueEntry).toHaveBeenCalledWith('event-1', 'queue-1'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
