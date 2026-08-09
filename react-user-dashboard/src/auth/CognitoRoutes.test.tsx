/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

const apiState = vi.hoisted(() => ({ code: 'LOCAL_PROFILE_NOT_FOUND' }));

vi.mock('./AuthProvider', () => ({ useAuth: () => ({ setSession: vi.fn() }) }));
vi.mock('../utils/cognitoAuth', () => ({ getCognitoAuthorizeUrl: () => '/api/v1/auth/authorize' }));
vi.mock('../utils/apiClient', () => ({
  default: { get: vi.fn(async () => { throw new Error('forbidden'); }) },
  getApiError: () => 'Access denied',
  getApiErrorCode: () => apiState.code,
  setSessionTokens: vi.fn(),
}));

const { CognitoCallback } = await import('./CognitoRoutes');

afterEach(() => { cleanup(); apiState.code = 'LOCAL_PROFILE_NOT_FOUND'; });

it('explains that verified Cognito access still requires a local staff profile', async () => {
  render(
    <MemoryRouter initialEntries={['/auth/callback?code=code&state=state']}>
      <Routes><Route path="/auth/callback" element={<CognitoCallback />} /></Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByText(/Cognito identity was verified/i)).toBeTruthy();
  expect(screen.getByText(/administrator must create or approve your staff profile/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Return home' }).getAttribute('href')).toBe('/');
});

it('does not mislabel another blocked account state as a missing profile', async () => {
  apiState.code = 'ACCOUNT_SESSION_BLOCKED';
  render(
    <MemoryRouter initialEntries={['/auth/callback?code=code&state=state']}>
      <Routes><Route path="/auth/callback" element={<CognitoCallback />} /></Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByText('Access denied')).toBeTruthy();
  expect(screen.queryByText(/Cognito identity was verified/i)).toBeNull();
});
