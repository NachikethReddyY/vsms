import axios from 'axios';

// Fixed: changed fallback port from 5050 to 5000 to match your Express server
const baseURL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/qa-api' : `${window.location.protocol}//${window.location.hostname}:5000`);

// Initialize tokens directly from localStorage
let accessToken: string | null = localStorage.getItem('authToken');
let csrfToken: string | null = localStorage.getItem('csrfToken');
let refreshPromise: Promise<string> | null = null;
let refreshSubscribers: ((token: string) => void)[] = [];

type RetryableRequest = import('axios').InternalAxiosRequestConfig & { _retry?: boolean };
type TokenPayload = { accessToken: string; csrfToken?: string };

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
};

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
  if (token) {
    localStorage.setItem('csrfToken', token);
  } else {
    localStorage.removeItem('csrfToken');
  }
};

export const getAccessToken = () => {
  if (!accessToken) {
    accessToken = localStorage.getItem('authToken');
  }
  return accessToken;
};

export const getCsrfToken = () => {
  if (!csrfToken) {
    csrfToken = localStorage.getItem('csrfToken');
  }
  return csrfToken;
};

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
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

// Request interceptor attaches both Auth Bearer token and CSRF token automatically
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  const csrf = getCsrfToken();
  
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (csrf) config.headers['X-CSRF-Token'] = csrf;
  
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
        headers: { 'X-CSRF-Token': getCsrfToken() || '' } 
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