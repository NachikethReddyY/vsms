import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { AuthSession } from "../types";
import { clearStoredSession, getStoredSession, setStoredSession } from "./session";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
});

const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
});

let refreshPromise: Promise<AuthSession> | null = null;

function getDeviceId() {
  const key = "vsms_device_id";
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    window.localStorage.setItem(key, value);
  }
  return value;
}

apiClient.interceptors.request.use((config) => {
  config.headers["X-Device-Id"] = getDeviceId();
  config.headers["X-Device-Name"] = "VSMS staff web";
  return config;
});

async function refreshSession(): Promise<AuthSession> {
  const response = await refreshClient.post("/auth/refresh", null, {
    headers: {
      "X-Device-Id": getDeviceId(),
      "X-Device-Name": "VSMS staff web",
    },
  });
  const nextSession: AuthSession = {
    user: response.data.user,
    expiresAt: Date.now() + Number(response.data.sessionExpiresIn || 2_592_000) * 1000,
  };
  setStoredSession(nextSession);
  return nextSession;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && getStoredSession()) {
      originalRequest._retry = true;
      try {
        refreshPromise ??= refreshSession().finally(() => {
          refreshPromise = null;
        });
        await refreshPromise;
        return apiClient(originalRequest);
      } catch (refreshError) {
        clearStoredSession();
        window.location.assign("/login?reason=session-expired");
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

// Compatibility helpers for the preserved main-branch AuthContext. Cognito
// tokens remain in HttpOnly cookies; these helpers never expose or store them.
export function getCsrfToken() {
  const match = document.cookie.match(/(?:^|; )vsms_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function setSessionTokens(session: unknown | null) {
  if (session === null) clearStoredSession();
}

export default apiClient;
