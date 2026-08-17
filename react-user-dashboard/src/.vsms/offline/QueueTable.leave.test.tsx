/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueTable, type QueueItem, type QueueStatus } from '../../components/queue/QueueTable';

const item = (queueNumber: number, status: QueueStatus): QueueItem => ({
  id: `queue-${queueNumber}`,
  registrationId: `registration-${queueNumber}`,
  queueNumber,
  status,
  isPriority: false,
  priorityNotes: null,
  participantDisplayName: `Participant ${queueNumber}`,
  participantReference: `P-${queueNumber}`,
  stationName: 'Visual acuity',
});

afterEach(() => cleanup());

describe('QueueTable leave action', () => {
  it('offers an accessible leave action only for waiting and called entries', async () => {
    const onAction = vi.fn();
    render(<QueueTable
      items={[
        item(1, 'WAITING'),
        item(2, 'CALLED'),
        item(3, 'IN_PROGRESS'),
        item(4, 'COMPLETED'),
      ]}
      filteredCount={4}
      searchQuery=""
      setSearchQuery={vi.fn()}
      statusFilter="ALL"
      setStatusFilter={vi.fn()}
      currentPage={1}
      setCurrentPage={vi.fn()}
      totalPages={1}
      actionLoading={null}
      canManagePriority={false}
      canOverrideRoute={false}
      onAction={onAction}
      onSetPriority={vi.fn()}
      onEditRoute={vi.fn()}
    />);

    const waitingLeave = screen.getByRole('button', { name: 'Leave queue 1' });
    expect(screen.getByRole('button', { name: 'Leave queue 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Leave queue 3' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave queue 4' })).toBeNull();
    await userEvent.click(waitingLeave);
    expect(onAction).toHaveBeenCalledWith('queue-1', 'LEFT');
  });
});
