import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import apiClient, { getCsrfToken, setSessionTokens } from '../utils/apiClient';
import type { components } from '../generated/api';
import { AuthContext, type User } from './authState';

type AuthResponse = components['schemas']['AuthResponse'];
let bootstrapSession: Promise<AuthResponse> | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  // Pre-load user from sessionStorage so hard refreshes don't flash a blank/null state
  const [user, setUser] = useState<User | null>(() => {
    try {
      const cachedUser = sessionStorage.getItem('vsms_user_cache');
      return cachedUser ? JSON.parse(cachedUser) : null;
    } catch {
      return null;
    }
  });
  
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const acceptSession = useCallback((data: AuthResponse) => {
    setSessionTokens(data);
    setUser(data.user);
    try {
      sessionStorage.setItem('vsms_user_cache', JSON.stringify(data.user));
    } catch { /* empty */ }
  }, []);

  useEffect(() => {
    const csrfMatch = document.cookie.match(/(?:^|; )vsms_csrf=([^;]+)/);
    const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
    
    if (!csrf) { 
      setIsBootstrapping(false); 
      return; 
    }
    
    setSessionTokens({ accessToken: '', csrfToken: csrf });
    
    bootstrapSession ??= apiClient.post<AuthResponse>('/auth/refresh', undefined, { headers: { 'X-CSRF-Token': csrf } })
      .then(({ data }) => data)
      .finally(() => { bootstrapSession = null; });

    bootstrapSession
      .then(acceptSession)
      .catch(() => {
        setSessionTokens(null);
        setUser(null);
        sessionStorage.removeItem('vsms_user_cache');
      })
      .finally(() => setIsBootstrapping(false));
  }, [acceptSession]);

  useEffect(() => {
    const endSession = () => {
      setUser(null);
      sessionStorage.removeItem('vsms_user_cache');
    };
    window.addEventListener('vsms:session-ended', endSession);
    return () => window.removeEventListener('vsms:session-ended', endSession);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', { identifier, password });
    acceptSession(data);
  }, [acceptSession]);

  const logout = useCallback(async () => {
    const csrf = getCsrfToken();
    try { 
      if (csrf) await apiClient.post('/auth/logout', undefined, { headers: { 'X-CSRF-Token': csrf } }); 
    }
    finally { 
      setSessionTokens(null); 
      setUser(null); 
      sessionStorage.removeItem('vsms_user_cache');
    }
  }, []);

  const value = useMemo(() => ({ user, isBootstrapping, login, logout }), [user, isBootstrapping, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
