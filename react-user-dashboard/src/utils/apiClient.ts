import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { AuthSession } from "../types";
import { clearStoredSession, getStoredSession, setStoredSession } from "./session";
import { getCognitoAuthorizeUrl } from "./cognitoAuth";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
type TokenPayload = { accessToken: string; csrfToken: string };
type RetryableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshPromise: Promise<AuthSession> | null = null;
let loginRedirectStarted = false;

export function setSessionTokens(tokens: TokenPayload | null) {
  accessToken = tokens?.accessToken || null;
  csrfToken = tokens?.csrfToken || null;
}

export function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const match = document.cookie.match(/(?:^|; )vsms_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getDeviceId() {
  const key = "vsms_device_id";
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    window.localStorage.setItem(key, value);
  }
  return value;
}

const commonHeaders = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const apiClient = axios.create({ baseURL, withCredentials: true, headers: commonHeaders });
const refreshClient = axios.create({ baseURL, withCredentials: true, headers: commonHeaders });

apiClient.interceptors.request.use((config) => {
  config.headers["X-Device-Id"] = getDeviceId();
  config.headers["X-Device-Name"] = "VSMS staff web";

  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  const requestCsrfToken = getCsrfToken();
  if (requestCsrfToken && !["get", "head", "options"].includes(config.method || "get")) {
    config.headers["X-CSRF-Token"] = requestCsrfToken;
  }
  return config;
});

async function rotateSession(): Promise<AuthSession> {
  const response = await refreshClient.post("/auth/refresh", {}, {
    headers: {
      "X-CSRF-Token": getCsrfToken(),
      "X-Device-Id": getDeviceId(),
      "X-Device-Name": "VSMS staff web",
    },
  });
  setSessionTokens(response.data);
  const session = {
    user: response.data.user,
    expiresAt: Date.now() + Number(response.data.sessionExpiresIn || 604_800) * 1000,
  };
  setStoredSession(session);
  return session;
}

export function refreshAuthSession() {
  refreshPromise ??= rotateSession().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !originalRequest.url?.startsWith("/auth/") && getStoredSession()) {
      originalRequest._retry = true;
      try {
        refreshPromise ??= rotateSession().finally(() => {
          refreshPromise = null;
        });
        await refreshPromise;
        return apiClient(originalRequest);
      } catch (refreshError) {
        setSessionTokens(null);
        clearStoredSession();
        if (!loginRedirectStarted) {
          loginRedirectStarted = true;
          window.location.replace(getCognitoAuthorizeUrl(`${window.location.pathname}${window.location.search}`));
        }
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export function getApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
    return error.response?.data?.error ?? error.response?.data?.message ?? fallback;
  }
  return fallback;
}

export default apiClient;
