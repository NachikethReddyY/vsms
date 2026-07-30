import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { AuthSession } from "../types";
import { clearStoredSession, getStoredSession, setStoredSession } from "./session";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
type TokenPayload = { accessToken: string; csrfToken: string; token?: string; user?: any; sessionExpiresIn?: number };
type RetryableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshPromise: Promise<AuthSession> | null = null;

export function setSessionTokens(tokens: TokenPayload | null) {
  if (tokens === null) {
    accessToken = null;
    csrfToken = null;
    clearStoredSession();
    return;
  }
  accessToken = tokens.accessToken || tokens.token || null;
  csrfToken = tokens.csrfToken || null;
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

  // Check if session contains an authorization token and attach it if available
  const session = getStoredSession();
  if (session && "token" in session && typeof session.token === "string" && session.token) {
    config.headers.Authorization = `Bearer ${session.token}`;
  } else if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

async function rotateSession(): Promise<AuthSession> {
  const response = await refreshClient.post("/auth/refresh", null, {
    headers: {
      "X-CSRF-Token": getCsrfToken() || "",
      "X-Device-Id": getDeviceId(),
      "X-Device-Name": "VSMS staff web",
    },
  });
  
  setSessionTokens(response.data);
  const session: AuthSession = {
    user: response.data.user,
    expiresAt: Date.now() + Number(response.data.sessionExpiresIn || 2_592_000) * 1000,
    token: response.data.token || response.data.accessToken,
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
    const request = error.config as RetryableRequestConfig | undefined;
    if (error.response?.status !== 401 || !request || request._retry || request.url?.startsWith("/auth/") || !getStoredSession()) {
      return Promise.reject(error);
    }
    request._retry = true;
    try {
      await refreshAuthSession();
      return apiClient(request);
    } catch (refreshError) {
      setSessionTokens(null);
      window.location.assign("/login?reason=session-expired");
      return Promise.reject(refreshError);
    }
  }
);

export function getApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
    return error.response?.data?.error ?? error.response?.data?.message ?? fallback;
  }
  return fallback;
}

export default apiClient;