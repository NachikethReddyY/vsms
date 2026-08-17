/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  listStations: vi.fn(),
  getOfflineStationContext: vi.fn(),
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'staff-1' } } }),
}));
vi.mock('../../features/stage4Api', () => ({ getEvent: vi.fn(), getCurrentAccount: vi.fn() }));
vi.mock('../../utils/apiClient', () => ({ getApiError: (_error: unknown, fallback: string) => fallback }));
vi.mock('../../features/screening/screeningApi', () => ({
  screeningApi: { listStations: dependencies.listStations },
}));
vi.mock('../../features/screening/offlineSync', () => ({
  getOfflineEventRoles: vi.fn(),
  getOfflineStationContext: dependencies.getOfflineStationContext,
  isNetworkError: (error: unknown) => (error as { code?: string })?.code === 'ERR_NETWORK',
}));

const { StationDutyGuard } = await import('../../auth/RoleGuard');

beforeEach(() => {
  dependencies.listStations.mockReset();
  dependencies.getOfflineStationContext.mockReset();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});

afterEach(cleanup);

function renderGuard() {
  render(
    <MemoryRouter initialEntries={['/events/event-1/stations/eye-health']}>
      <Routes>
        <Route element={<StationDutyGuard stationType="EYE_HEALTH" />}>
          <Route path="/events/:eventId/stations/eye-health" element={<p>Eye health duty</p>} />
        </Route>
        <Route path="/forbidden" element={<p>Forbidden</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('offline station duty authorization', () => {
  it('uses the encrypted downloaded station scope without calling the network', async () => {
    dependencies.getOfflineStationContext.mockResolvedValue({ station: { stationId: 'eye-1', isActive: true } });

    renderGuard();

    expect(await screen.findByText('Eye health duty')).toBeTruthy();
    expect(dependencies.listStations).not.toHaveBeenCalled();
    expect(dependencies.getOfflineStationContext).toHaveBeenCalledWith('staff-1', 'event-1', 'EYE_HEALTH', undefined);
  });

  it('denies a station absent from the downloaded scope', async () => {
    dependencies.getOfflineStationContext.mockResolvedValue(null);

    renderGuard();

    expect(await screen.findByText('Forbidden')).toBeTruthy();
  });
});
