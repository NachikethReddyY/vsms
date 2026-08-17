/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { roles: ['SCREENER'] } }, clearSession: vi.fn() }),
}));
vi.mock('../../features/screening/OfflineSyncControl', () => ({
  OfflineSyncControl: ({ eventId }: { eventId: string }) => <span>Offline prep {eventId}</span>,
}));
vi.mock('../../utils/idleTimer', () => ({ setupIdleTimer: () => vi.fn() }));
vi.mock('../../utils/logout', () => ({ logoutAndReturnHome: vi.fn() }));
vi.mock('../../components/MagicEffects', () => ({ ThemeToggle: () => null }));
vi.mock('../../components/ProfileMenu', () => ({ default: () => null }));

const AppShell = (await import('../../components/AppShell')).default;

beforeAll(() => { Element.prototype.scrollTo = vi.fn(); });
afterEach(cleanup);

describe('eye-health offline preparation', () => {
  it('shows the offline preparation control on the eye-health station route', () => {
    render(
      <MemoryRouter initialEntries={['/events/event-1/stations/eye-health']}>
        <AppShell><p>Station</p></AppShell>
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Offline prep event-1')).toHaveLength(2);
  });
});
