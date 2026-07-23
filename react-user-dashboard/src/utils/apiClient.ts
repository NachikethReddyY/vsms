import axios, { type InternalAxiosRequestConfig } from 'axios';

const qaMirror = window.location.protocol === 'http:' && window.location.port === '5174';
const baseURL = import.meta.env.VITE_API_BASE_URL ?? (qaMirror ? '/qa-api' : 'https://localhost:5050');
let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
type RetryableRequest = InternalAxiosRequestConfig & { _retry?: boolean };
type TokenPayload = { accessToken: string; csrfToken: string };

export const setSessionTokens = (tokens: TokenPayload | null) => {
  accessToken = tokens?.accessToken || null;
  csrfToken = tokens?.csrfToken || null;
};
export const getCsrfToken = () => csrfToken;

const apiClient = axios.create({ baseURL, withCredentials: true, headers: { 'Content-Type': 'application/json' }, timeout: 15_000 });
const refreshClient = axios.create({ baseURL, withCredentials: true, timeout: 15_000 });

apiClient.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

apiClient.interceptors.response.use((response) => response, async (error) => {
  const request = error.config as RetryableRequest | undefined;
  if (error.response?.status !== 401 || !request || request._retry || request.url?.startsWith('/auth/')) return Promise.reject(error);
  request._retry = true;
  try {
    refreshPromise ??= refreshClient.post<TokenPayload>('/auth/refresh', undefined, { headers: { 'X-CSRF-Token': csrfToken } })
      .then(({ data }) => { setSessionTokens(data); return data.accessToken; })
      .finally(() => { refreshPromise = null; });
    request.headers.Authorization = `Bearer ${await refreshPromise}`;
    return apiClient(request);
  } catch (refreshError) {
    setSessionTokens(null);
    window.dispatchEvent(new Event('vsms:session-ended'));
    return Promise.reject(refreshError);
  }
});

export default apiClient;
