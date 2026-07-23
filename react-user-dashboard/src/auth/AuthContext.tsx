import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import apiClient, { getCsrfToken, setSessionTokens } from '../utils/apiClient';
import type { components } from '../generated/api';
import { AuthContext, type User } from './authState';

type AuthResponse = components['schemas']['AuthResponse'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const acceptSession = useCallback((data: AuthResponse) => {
    setSessionTokens(data);
    setUser(data.user);
  }, []);

  useEffect(() => {
    const csrfMatch = document.cookie.match(/(?:^|; )vsms_csrf=([^;]+)/);
    const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
    if (!csrf) { setIsBootstrapping(false); return; }
    setSessionTokens({ accessToken: '', csrfToken: csrf });
    apiClient.post<AuthResponse>('/auth/refresh', undefined, { headers: { 'X-CSRF-Token': csrf } })
      .then(({ data }) => acceptSession(data))
      .catch(() => setSessionTokens(null))
      .finally(() => setIsBootstrapping(false));
  }, [acceptSession]);

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
    const csrf = getCsrfToken();
    try { if (csrf) await apiClient.post('/auth/logout', undefined, { headers: { 'X-CSRF-Token': csrf } }); }
    finally { setSessionTokens(null); setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, isBootstrapping, login, logout }), [user, isBootstrapping, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
