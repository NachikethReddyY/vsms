import axios from 'axios';
import { useCallback } from 'react';
import { useAuth as useStaffAuth } from './AuthProvider';
import apiClient, { setSessionTokens } from '../utils/apiClient';
import type { AppUser } from '../types';

export type User = AppUser;

export function useAuth() {
  const { session, setSession, clearSession } = useStaffAuth();

  const login = useCallback(async (identifier: string, password: string) => {
    const { data } = await apiClient.post('/auth/login', { identifier, password });
    setSessionTokens(data);
    setSession({
      user: data.user,
      expiresAt: Date.now() + Number(data.sessionExpiresIn || 604_800) * 1000,
    });
  }, [setSession]);

  const logout = useCallback(async () => {
    try { await apiClient.post('/auth/logout'); }
    finally { clearSession(); }
  }, [clearSession]);

  return { user: session?.user ?? null, isBootstrapping: false, bootstrapError: '', login, logout };
}

export function getApiMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'The secure service is unavailable. Check your connection and try again.';
    const data = error.response.data as { error?: string; message?: string; title?: string; errors?: { message: string }[] } | undefined;
    return data?.errors?.[0]?.message ?? data?.title ?? data?.error ?? data?.message ?? fallback;
  }
  return fallback;
}
