import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('./apiClient', () => ({ default: { post } }));

import { logoutAndReturnHome } from './logout';

const replace = vi.fn();

beforeEach(() => {
  post.mockReset();
  replace.mockReset();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { href: 'https://localhost:5173/events', replace } },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('logoutAndReturnHome', () => {
  it('waits for cookie revocation before returning to HTTPS home', async () => {
    const clearSession = vi.fn();
    let resolveLogout!: (value: unknown) => void;
    post.mockImplementation(() => new Promise((resolve) => { resolveLogout = resolve; }));

    const logout = logoutAndReturnHome(clearSession);
    await Promise.resolve();

    expect(post).toHaveBeenCalledWith('/auth/logout');
    expect(clearSession).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    resolveLogout({ data: { logoutUrl: 'https://vsms.auth.ap-southeast-1.amazoncognito.com/logout?client_id=test-client&logout_uri=https%3A%2F%2Flocalhost%3A5173%2F' } });
    await logout;
    expect(replace).toHaveBeenCalledWith('https://vsms.auth.ap-southeast-1.amazoncognito.com/logout?client_id=test-client&logout_uri=https%3A%2F%2Flocalhost%3A5173%2F');
  });

  it('locks the local session without deleting encrypted offline work when server revocation fails', async () => {
    const clearSession = vi.fn();
    post.mockRejectedValue(new Error('CSRF validation failed'));

    await logoutAndReturnHome(clearSession);

    expect(clearSession).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith('https://localhost:5173/');
  });
});
