import axios, { type InternalAxiosRequestConfig } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/qa-api' : `${window.location.protocol}//${window.location.hostname}:5050`);

let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
let refreshSubscribers: ((token: string) => void)[] = [];

type RetryableRequest = InternalAxiosRequestConfig & { _retry?: boolean };
type TokenPayload = { accessToken: string; csrfToken?: string };

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

export const getAccessToken = () => accessToken;
export const getCsrfToken = () => csrfToken;

// Unified single declaration for setSessionTokens
export const setSessionTokens = (tokens: TokenPayload | null) => {
  if (!tokens) {
    setAccessToken(null);
    setCsrfToken(null);
    return;
  }
  if (tokens.accessToken) setAccessToken(tokens.accessToken);
  if (tokens.csrfToken !== undefined) setCsrfToken(tokens.csrfToken || null);
};

const apiClient = axios.create({
  baseURL,
  withCredentials: true, // Crucial for cookie-based session refreshing
  headers: { 'Content-Type': 'application/json' },
});

// Dedicated client for refreshing tokens to prevent infinite interceptor loops
const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const request = error.config as RetryableRequest | undefined;
    
    if (error.response?.status !== 401 || !request || request._retry || request.url?.startsWith('/auth/')) {
      return Promise.reject(error);
    }

    request._retry = true;

    try {
      refreshPromise ??= refreshClient.post<TokenPayload>('/auth/refresh', undefined, { 
        headers: { 'X-CSRF-Token': csrfToken || '' } 
      })
        .then(({ data }) => { 
          setSessionTokens(data); 
          onRefreshed(data.accessToken);
          return data.accessToken; 
        })
        .finally(() => { 
          refreshPromise = null; 
        });

      const newAccessToken = await refreshPromise;
      request.headers.Authorization = `Bearer ${newAccessToken}`;
      return apiClient(request);
    } catch (refreshError) {
      setSessionTokens(null);
      window.dispatchEvent(new Event('vsms:session-ended'));
      return Promise.reject(refreshError);
    }
  }
);

export default apiClient;