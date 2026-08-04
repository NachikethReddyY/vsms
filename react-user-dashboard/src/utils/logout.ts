import apiClient from "./apiClient";
import { clearOfflineData } from "../features/screening/offlineSync";

export async function logoutAndReturnHome(clearSession: () => void) {
  clearSession();
  let logoutUrl: string | null = null;
  try {
    const response = await apiClient.post<{ logoutUrl?: string }>("/auth/logout");
    const candidate = response.data.logoutUrl;
    if (candidate && new URL(candidate).protocol === "https:") logoutUrl = candidate;
  } catch {
    // HttpOnly cookies can only be cleared by the server. Local and offline
    // artifacts are still cleared before the secure fallback navigation.
  } finally {
    await clearOfflineData().catch(() => {});
    const landing = new URL("/", window.location.href);
    landing.protocol = "https:";
    window.location.replace(logoutUrl ?? landing.toString());
  }
}
