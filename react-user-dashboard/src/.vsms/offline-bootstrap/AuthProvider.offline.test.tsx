/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  stored: null as { user: { id: string; approvalState: string; accessState: string; roles: string[] }; expiresAt: number } | null,
  refresh: vi.fn(),
  clearStored: vi.fn(),
  setTokens: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({
  beginLogout: vi.fn(),
  getCsrfToken: () => 'csrf',
  refreshAuthSession: auth.refresh,
  setSessionTokens: auth.setTokens,
}));
vi.mock('../../utils/session', () => ({
  clearLogoutPending: vi.fn(),
  clearStoredSession: auth.clearStored,
  getStoredSession: () => auth.stored,
  isLogoutPending: () => false,
  setStoredSession: vi.fn(),
}));

const { AuthProvider, useAuth } = await import('../../auth/AuthProvider');

function State() {
  const value = useAuth();
  return <p>{value.isBootstrapping ? 'booting' : value.isAuthenticated ? value.session?.user.id : 'locked'}</p>;
}

beforeEach(() => {
  auth.stored = {
    user: { id: 'staff-1', approvalState: 'APPROVED', accessState: 'ENABLED', roles: ['SCREENER'] },
    expiresAt: Date.now() + 60_000,
  };
  auth.refresh.mockReset();
  auth.clearStored.mockReset();
  auth.setTokens.mockReset();
});

afterEach(cleanup);

describe('offline auth bootstrap', () => {
  it('retains a still-valid stored session when refresh cannot reach the network', async () => {
    auth.refresh.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));

    render(<AuthProvider><State /></AuthProvider>);

    expect(await screen.findByText('staff-1')).toBeTruthy();
    expect(auth.clearStored).not.toHaveBeenCalled();
    expect(auth.setTokens).not.toHaveBeenCalled();
  });

  it('clears the session after an authoritative HTTP refresh rejection', async () => {
    auth.refresh.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

    render(<AuthProvider><State /></AuthProvider>);

    expect(await screen.findByText('locked')).toBeTruthy();
    expect(auth.clearStored).toHaveBeenCalledOnce();
    expect(auth.setTokens).toHaveBeenCalledWith(null);
  });
});
