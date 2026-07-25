import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export interface SessionTokens {
  accessToken: string;
  csrfToken?: string;
}

interface RefreshResponse {
  accessToken: string;
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let accessToken: string | null = null;
let csrfToken: string | null = null;
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

export const setCsrfToken = (token: string | null) => { csrfToken = token; };
export const getCsrfToken = (): string | null => csrfToken;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (token) localStorage.setItem('authToken', token);
  else localStorage.removeItem('authToken');
};
export const getAccessToken = (): string | null => accessToken || localStorage.getItem('authToken');

export const setSessionTokens = (tokens: SessionTokens | null) => {
  if (!tokens) {
    setAccessToken(null);
    setCsrfToken(null);
    localStorage.removeItem('refreshToken');
    return;
  }
  if (tokens.accessToken) setAccessToken(tokens.accessToken);
  if (tokens.csrfToken !== undefined) setCsrfToken(tokens.csrfToken);
};

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

const refreshAccessToken = async (): Promise<string> => {
  const refreshToken = localStorage.getItem('refreshToken');
  const response = await axios.post<RefreshResponse>(
    `${BASE_URL}/auth/refresh`,
    { refreshToken },
    { headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} }
  );
  const newAccessToken = response.data.accessToken;
  setAccessToken(newAccessToken);
  return newAccessToken;
};

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (originalRequest.url?.includes('/auth/refresh')) return Promise.reject(error);

      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshSubscribers.push((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        isRefreshing = false;
        onRefreshed(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];
        setSessionTokens(null);
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;