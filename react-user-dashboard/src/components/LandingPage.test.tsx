/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let publicSignupEnabled = false;

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock('./MagicEffects', () => ({ ThemeToggle: () => <button>Theme</button> }));
vi.mock('../utils/apiClient', () => ({
  default: { get: vi.fn(async () => ({ data: { publicSignupEnabled } })) },
}));

const LandingPage = (await import('./LandingPage')).default;

beforeEach(() => {
  publicSignupEnabled = false;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
});
afterEach(cleanup);

it('advertises public signup only when the backend enables it', async () => {
  const view = render(<MemoryRouter><LandingPage /></MemoryRouter>);
  expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull();

  publicSignupEnabled = true;
  view.unmount();
  render(<MemoryRouter><LandingPage /></MemoryRouter>);
  expect((await screen.findByRole('link', { name: 'Sign up' })).getAttribute('href')).toBe('/create-account');
});
