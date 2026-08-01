import { createContext, useContext } from 'react';
import axios from 'axios';
import type { components } from '../generated/api';

export type User = components['schemas']['User'];
export type AuthContextValue = {
  user: User | null;
  isBootstrapping: boolean;
  bootstrapError: string;
  login(identifier: string, password: string): Promise<void>;
  logout(): Promise<void>;
  retrySession(): void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function getApiMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'The secure service is unavailable. Check your connection and try again.';
    const data = error.response?.data as { title?: string; errors?: { message: string }[] } | undefined;
    return data?.errors?.[0]?.message ?? data?.title ?? fallback;
  }
  return fallback;
}
