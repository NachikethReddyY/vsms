/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const dependencies = vi.hoisted(() => ({
  getEvent: vi.fn(),
  listMemberships: vi.fn(),
}));

vi.mock('../../features/events/eventApi', () => ({ eventApi: { get: dependencies.getEvent } }));
vi.mock('../../features/screening/offlineSync', () => ({ isNetworkError: vi.fn(() => true) }));
vi.mock('../../features/stage4Api', () => ({
  listMemberships: dependencies.listMemberships,
  getEvent: vi.fn(),
  listEligibleUsers: vi.fn(),
  addMembership: vi.fn(),
  addMembershipRole: vi.fn(),
  removeMembershipRole: vi.fn(),
  removeMembership: vi.fn(),
}));

import EventStaffingPage from '../../features/EventStaffingPage';

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  dependencies.getEvent.mockResolvedValue({
    eventId: '22222222-2222-4222-8222-222222222222',
    shifts: [{
      staffAssignments: [{
        assignmentRole: 'SCREENER',
        user: { userId: '33333333-3333-4333-8333-333333333333', fullName: 'Asha Rao' },
      }],
    }],
  });
});

afterEach(cleanup);

describe('offline event staffing', () => {
  it('shows downloaded duties read-only without calling the staffing API', async () => {
    render(
      <MemoryRouter initialEntries={['/events/22222222-2222-4222-8222-222222222222/staff']}>
        <Routes><Route path="/events/:eventId/staff" element={<EventStaffingPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText(/Showing downloaded duties on this device/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add staff/i })).toBeNull();
    expect(dependencies.listMemberships).not.toHaveBeenCalled();
  });
});
