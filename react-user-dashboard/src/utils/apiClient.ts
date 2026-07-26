import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { AuthSession } from "../types";
import { clearStoredSession, getStoredSession, setStoredSession } from "./session";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000/api/v1";

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const apiClient = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
  },
});

const refreshClient = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
  },
});

let isRefreshing = false;
let refreshSubscribers: Array<(session: AuthSession) => void> = [];

function notifyRefreshSubscribers(session: AuthSession) {
  refreshSubscribers.forEach((callback) => callback(session));
  refreshSubscribers = [];
}

async function refreshAccessToken(session: AuthSession): Promise<AuthSession> {
  const response = await refreshClient.post("/auth/refresh", {
    email: session.email,
    refreshToken: session.refreshToken,
  });

  const updatedSession: AuthSession = {
    accessToken: response.data.accessToken,
    idToken: response.data.idToken ?? session.idToken,
    refreshToken: session.refreshToken,
    email: response.data.user?.email ?? session.email,
    user: response.data.user ?? session.user,
  };

  setStoredSession(updatedSession);
  return updatedSession;
}

apiClient.interceptors.request.use((config) => {
  const session = getStoredSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const session = getStoredSession();

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      session?.refreshToken
    ) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshSubscribers.push((nextSession) => {
            originalRequest.headers.Authorization = `Bearer ${nextSession.accessToken}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const nextSession = await refreshAccessToken(session);
        notifyRefreshSubscribers(nextSession);
        originalRequest.headers.Authorization = `Bearer ${nextSession.accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        clearStoredSession();
        window.location.assign("/login?reason=session-expired");
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
