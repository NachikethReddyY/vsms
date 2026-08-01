import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import apiClient, { announceSessionEnded, getCsrfToken, readCsrfCookie, refreshSession, setSessionTokens, withSessionLock } from '../utils/apiClient';
import type { components } from '../generated/api';
import { AuthContext, type User } from './authState';

type AuthResponse = components['schemas']['AuthResponse'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');

  const acceptSession = useCallback((data: AuthResponse) => {
    setSessionTokens(data);
    setUser(data.user);
    setBootstrapError('');
  }, []);

  const restoreSession = useCallback(() => {
    setIsBootstrapping(true);
    setBootstrapError('');
    const csrf = readCsrfCookie();
    if (!csrf) { setIsBootstrapping(false); return; }
    setSessionTokens({ accessToken: '', csrfToken: csrf });
    refreshSession()
      .then(acceptSession)
      .catch((error) => {
        setSessionTokens(null);
        setUser(null);
        if (!axios.isAxiosError(error) || !error.response || error.response.status >= 500) {
          setBootstrapError('The secure session service is unavailable.');
        }
      })
      .finally(() => setIsBootstrapping(false));
  }, [acceptSession]);

  useEffect(() => { restoreSession(); }, [restoreSession]);

  useEffect(() => {
    const endSession = () => setUser(null);
    window.addEventListener('vsms:session-ended', endSession);
    return () => window.removeEventListener('vsms:session-ended', endSession);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', { identifier, password });
    acceptSession(data);
  }, [acceptSession]);

  const logout = useCallback(async () => {
    try {
      await withSessionLock(async () => {
        const csrf = readCsrfCookie() || getCsrfToken();
        if (csrf) await apiClient.post('/auth/logout', undefined, { headers: { 'X-CSRF-Token': csrf } });
      });
    } finally { announceSessionEnded(); setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, isBootstrapping, bootstrapError, login, logout, retrySession: restoreSession }), [user, isBootstrapping, bootstrapError, login, logout, restoreSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
