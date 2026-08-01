import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { components } from '../generated/api';

const qaMirror = window.location.protocol === 'http:' && window.location.port === '5174';
const baseURL = import.meta.env.VITE_API_BASE_URL ?? (qaMirror ? '/qa-api' : `https://${window.location.hostname}:5050`);
let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshPromise: Promise<SessionPayload> | null = null;
type RetryableRequest = InternalAxiosRequestConfig & { _retry?: boolean };
type SessionPayload = components['schemas']['AuthResponse'];
export type TokenPayload = Pick<SessionPayload, 'accessToken' | 'csrfToken'>;

export const setSessionTokens = (tokens: TokenPayload | null) => {
  accessToken = tokens?.accessToken || null;
  csrfToken = tokens?.csrfToken || null;
};
export const getCsrfToken = () => csrfToken;

const apiClient = axios.create({ baseURL, withCredentials: true, headers: { 'Content-Type': 'application/json' }, timeout: 15_000 });
const refreshClient = axios.create({ baseURL, withCredentials: true, timeout: 15_000 });

export const refreshSession = () => {
  if (!csrfToken) return Promise.reject(new Error('Missing CSRF token'));
  refreshPromise ??= refreshClient.post<SessionPayload>('/auth/refresh', undefined, { headers: { 'X-CSRF-Token': csrfToken } })
    .then(({ data }) => { setSessionTokens(data); return data; })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
};

apiClient.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

apiClient.interceptors.response.use((response) => response, async (error) => {
  const request = error.config as RetryableRequest | undefined;
  if (error.response?.status !== 401 || !request || request._retry || request.url?.startsWith('/auth/')) return Promise.reject(error);
  request._retry = true;
  try {
    request.headers.Authorization = `Bearer ${(await refreshSession()).accessToken}`;
    return apiClient(request);
  } catch (refreshError) {
    setSessionTokens(null);
    window.dispatchEvent(new Event('vsms:session-ended'));
    return Promise.reject(refreshError);
  }
});

export default apiClient;
