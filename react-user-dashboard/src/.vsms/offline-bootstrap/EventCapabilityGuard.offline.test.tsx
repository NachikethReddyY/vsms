/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({ getOfflineEventRoles: vi.fn() }));

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'staff-1', roles: [] } } }),
}));
vi.mock('../../features/stage4Api', () => ({ getEvent: vi.fn(), getCurrentAccount: vi.fn() }));
vi.mock('../../features/screening/screeningApi', () => ({ screeningApi: { listStations: vi.fn() } }));
vi.mock('../../utils/apiClient', () => ({ getApiError: (_error: unknown, fallback: string) => fallback }));
vi.mock('../../features/screening/offlineSync', () => ({
  getOfflineEventRoles: dependencies.getOfflineEventRoles,
  getOfflineStationContext: vi.fn(),
  isNetworkError: (error: unknown) => (error as { code?: string })?.code === 'ERR_NETWORK',
}));

const { EventCapabilityGuard } = await import('../../auth/RoleGuard');

beforeEach(() => {
  dependencies.getOfflineEventRoles.mockReset();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});
afterEach(cleanup);

it('authorizes an offline event route only from the encrypted pack roles', async () => {
  dependencies.getOfflineEventRoles.mockResolvedValue(['REGISTRATION_OFFICER']);
  render(
    <MemoryRouter initialEntries={['/events/event-1/register']}>
      <Routes>
        <Route element={<EventCapabilityGuard allowedRoles={['REGISTRATION_OFFICER']} />}>
          <Route path="/events/:eventId/register" element={<p>Registration workspace</p>} />
        </Route>
        <Route path="/forbidden" element={<p>Forbidden</p>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Registration workspace')).toBeTruthy();
});
