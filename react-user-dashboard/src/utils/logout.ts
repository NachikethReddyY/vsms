import apiClient from "./apiClient";
import { clearOfflineData } from "../features/screening/offlineSync";

export async function logoutAndReturnHome(clearSession: () => void) {
  clearSession();
  try {
    await apiClient.post("/auth/logout");
  } catch {
    // Local cleanup and navigation still protect the workstation if revocation fails.
  } finally {
    await clearOfflineData().catch(() => {});
    const landing = new URL("/", window.location.href);
    landing.protocol = "https:";
    window.location.replace(landing.toString());
  }
}
